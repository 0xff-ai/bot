// Drafts changelog entries with the Vercel AI SDK against an OpenAI-compatible
// gateway. Output is structured (generateText + Output.object + a Zod schema)
// rather than free text: more reliable on small/cheap models, no brittle parsing.
//
// The gateway is deployment config, not code: OPENAI_API_KEY, OPENAI_BASE_URL, and
// OPENAI_MODEL are all required with no in-code fallback, so a misconfigured
// deployment fails loudly instead of silently hitting a baked-in default. The
// product line and areas come from the consuming repo's bot.yml.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import type { Config } from "./config";

/** Entry classification, shown as a `**Label:**` prefix on the bullet. */
const TYPE_IDS = ["feature", "fix", "improvement", "performance", "breaking", "deprecation", "removal", "security"] as const;
const TYPE_LABELS: Record<string, string> = {
  feature: "Feature", feat: "Feature", new: "Feature",
  fix: "Fix", bugfix: "Fix", bug: "Fix",
  improvement: "Improvement", enhancement: "Improvement", improve: "Improvement",
  performance: "Performance", perf: "Performance",
  breaking: "Breaking",
  deprecation: "Deprecation", deprecated: "Deprecation",
  removal: "Removal", removed: "Removal", remove: "Removal",
  security: "Security",
};

/** Canonical display label for a model-returned type, or "Change" if unknown. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type.trim().toLowerCase()] ?? "Change";
}

export type ChangelogEntry = {
  area: string;
  type: string;
  short: string;
  medium: string;
  long: string;
};

export type ChangelogDraft = {
  skip: boolean;
  entries: ChangelogEntry[];
};

/** Draft one entry per distinct user-facing change in a PR, each in three lengths. */
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

  // area/type are free strings, not z.enum: the model empties or near-misses them,
  // which a strict enum rejects. We resolve them to canonical values afterwards.
  const entrySchema = z.object({
    area: z.string().describe(`one of these product area ids: ${config.areas.ids.join(", ")}`),
    type: z.string().describe(`one of: ${TYPE_IDS.join(", ")}`),
    short: z.string().describe("one terse line, roughly 6-10 words"),
    medium: z.string().describe("one sentence, roughly 15-25 words"),
    long: z.string().describe("one or two sentences with the user-facing detail, roughly 30-50 words"),
  });
  const schema = z.object({
    skip: z.boolean().describe("true when the PR has no user-facing change (chore, pure refactor, tests, CI)"),
    entries: z.array(entrySchema).describe("one entry per distinct user-facing change; empty when skip"),
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
        maxOutputTokens: 2048,
        abortSignal: AbortSignal.timeout(60_000),
      });
      return {
        skip: output.skip,
        entries: output.entries.map((e) => ({
          ...e,
          area: config.areas.resolve(e.area)?.id ?? config.areas.fallback.id,
        })),
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

From a PR title and diff, identify each DISTINCT user-facing change and write one entry for each, in three lengths (short, medium, long). A small PR usually has one entry; a larger PR may have several. Do not split a single change into multiple entries, and do not merge unrelated changes into one.

For each entry:
- Classify its type as one of: ${TYPE_IDS.join(", ")}.
- Pick the single best-fitting product area id from: ${config.areas.ids.join(", ")}.
- Describe observable behavior, not implementation. No commit-type prefixes, no file names, no internal module names.

If the PR has no user-facing change (chore, pure refactor, tests, CI, dependency bumps), set skip=true and entries=[].

Respond with JSON only, matching this shape:
{
  "skip": false,
  "entries": [
    { "area": "${exampleArea}", "type": "feature", "short": "one terse line", "medium": "one sentence", "long": "one or two sentences" }
  ]
}`;
}

function userPrompt(title: string, diff: string): string {
  const MAX_DIFF = 60_000;
  const clipped = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n... [diff truncated]` : diff;
  return `PR title: ${title}\n\nUnified diff:\n${clipped}\n\nReturn the changelog entries as JSON.`;
}
