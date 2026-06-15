// Drafts a changelog entry with the Vercel AI SDK against an OpenAI-compatible
// gateway. Output is structured (generateObject + a Zod schema) rather than free
// text: more reliable on small/cheap models, and it removes any brittle parse step.
//
// The gateway is deployment config, not code: OPENAI_API_KEY, OPENAI_BASE_URL, and
// OPENAI_MODEL are all required with no in-code fallback, so a misconfigured
// deployment fails loudly instead of silently hitting a baked-in default. The
// product line and areas come from the consuming repo's bot.yml.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import type { Config } from "./config";

export type ChangelogDraft = {
  skip: boolean;
  area: string;
  short: string;
  medium: string;
  long: string;
};

/** Draft one changelog entry in three lengths from a PR title and diff. */
export async function draftChangelogOptions(
  config: Config,
  title: string,
  diff: string,
): Promise<ChangelogDraft> {
  const env = loadEnv();
  const provider = createOpenAICompatible({
    name: "openai",
    baseURL: env.OPENAI_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
  });
  const model = provider(env.OPENAI_MODEL);

  // area is a free string, not z.enum: the model empties it on skip (and can
  // return a heading or near-miss id), which a strict enum rejects. We resolve it
  // to a real id afterwards instead.
  const schema = z.object({
    skip: z.boolean().describe("true when the PR has no user-facing change (chore, pure refactor, tests, CI)"),
    area: z.string().describe(`one of these product area ids: ${config.areas.ids.join(", ")} (empty when skip)`),
    short: z.string().describe("one terse line, roughly 6-10 words; empty when skip"),
    medium: z.string().describe("one sentence, roughly 15-25 words; empty when skip"),
    long: z.string().describe("one or two sentences with the user-facing detail, roughly 30-50 words; empty when skip"),
  });

  // json_object mode is not grammar-constrained, so the model occasionally samples
  // JSON that fails validation. temperature 0 minimises that and a few retries
  // cover the residue. Real errors (auth, balance, timeout) are not retried.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema }),
        system: systemPrompt(config),
        prompt: userPrompt(title, diff),
        temperature: 0,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(60_000),
      });
      return {
        ...output,
        area: config.areas.resolve(output.area)?.id ?? config.areas.fallback.id,
      };
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      lastError = error;
      console.error(`draft attempt ${attempt + 1} did not match schema`);
      console.error("  cause:", error.cause instanceof Error ? error.cause.message : String(error.cause));
      console.error("  raw model response:", error.text ?? "(none)");
    }
  }
  throw lastError;
}

// The drafter's deployment config, declared and validated at the boundary. All
// required, no defaults: a misconfigured deployment fails loudly here. Only the
// propose path needs these, so they live with the drafter, not in a global env.
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url(),
  OPENAI_MODEL: z.string().min(1),
});

function loadEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`missing or invalid LLM config: ${fields}`);
  }
  return parsed.data;
}

// DeepSeek json_object mode needs both the word "json" and an example of the
// desired shape in the prompt to reliably emit valid JSON; this provides both.
function systemPrompt(config: Config): string {
  const exampleArea = config.areas.ids[0];
  return `You write end-user changelog entries for ${config.product}.

From a PR title and diff, produce a single changelog entry in three lengths (short, medium, long), all describing the same change in the same plain, user-facing style.

Rules:
- Describe observable behavior, not implementation. No commit-type prefixes, no file names, no internal module names.
- Pick the single best-fitting product area id from: ${config.areas.ids.join(", ")}.
- If the PR has no user-facing change (chore, pure refactor, tests, CI, dependency bumps), set skip=true and leave the text fields empty.

Respond with JSON only, matching this shape:
{
  "skip": false,
  "area": "${exampleArea}",
  "short": "one terse line, ~6-10 words",
  "medium": "one sentence, ~15-25 words",
  "long": "one or two sentences, ~30-50 words"
}`;
}

function userPrompt(title: string, diff: string): string {
  const MAX_DIFF = 60_000;
  const clipped = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n... [diff truncated]` : diff;
  return `PR title: ${title}\n\nUnified diff:\n${clipped}\n\nReturn the changelog entry as JSON.`;
}
