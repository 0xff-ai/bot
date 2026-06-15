// Drafts a changelog entry with the Vercel AI SDK against an OpenAI-compatible
// gateway. Output is structured (generateObject + a Zod schema) rather than free
// text: more reliable on small/cheap models, and it removes any brittle parse step.
//
// The model and endpoint are config, not code: set OPENAI_API_KEY, and override
// OPENAI_BASE_URL / OPENAI_MODEL to point at a different gateway or model. The
// product line and areas come from the consuming repo's bot.yml.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";
import type { Config } from "./config";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";
const DEFAULT_MODEL = "opencode/deepseek-v4-flash";

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const provider = createOpenAICompatible({
    name: "openai",
    baseURL: process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    apiKey,
  });
  const model = provider(process.env.OPENAI_MODEL || DEFAULT_MODEL);

  const schema = z.object({
    skip: z.boolean().describe("true when the PR has no user-facing change (chore, pure refactor, tests, CI)"),
    area: z.enum(config.areas.ids).describe("the single product area this change belongs to"),
    short: z.string().describe("one terse line, roughly 6-10 words; empty when skip"),
    medium: z.string().describe("one sentence, roughly 15-25 words; empty when skip"),
    long: z.string().describe("one or two sentences with the user-facing detail, roughly 30-50 words; empty when skip"),
  });

  const { object } = await generateObject({
    model,
    schema,
    system: systemPrompt(config),
    prompt: userPrompt(title, diff),
  });
  return object as ChangelogDraft;
}

// "JSON" is named on purpose: DeepSeek's json_object response format requires the
// word to appear in the prompt.
function systemPrompt(config: Config): string {
  return `You write end-user changelog entries for ${config.product}.

From a PR title and diff, produce a single changelog entry in three lengths (short, medium, long), all describing the same change in the same plain, user-facing style. Return JSON matching the provided schema.

Rules:
- Describe observable behavior, not implementation. No commit-type prefixes, no file names, no internal module names.
- Pick the single best-fitting product area from the schema's enum.
- If the PR has no user-facing change (chore, pure refactor, tests, CI, dependency bumps), set skip=true and leave the text fields empty.`;
}

function userPrompt(title: string, diff: string): string {
  const MAX_DIFF = 60_000;
  const clipped = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n... [diff truncated]` : diff;
  return `PR title: ${title}\n\nUnified diff:\n${clipped}`;
}
