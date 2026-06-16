// Drafts changelog entries with the Vercel AI SDK against an OpenAI-compatible
// gateway. Output is structured (generateText + Output.object + a Zod schema):
// the model returns JSON and Output.object validates it against the schema, so we
// never hand-parse free text and never lose the schema guarantee.
//
// Whether the provider sends a strict json_schema response_format depends on the
// model (supportsJsonSchema): mimo/glm/kimi accept it on OpenCode Go, while
// DeepSeek V4 rejects json_schema with "This response_format type is unavailable
// now" and only supports json_object. For json_object models the provider emits a
// benign "JSON response format schema is only supported with structuredOutputs"
// warning and Output.object still validates the returned JSON against the schema.
// Either way the schema guarantee holds: do NOT drop Output.object for manual
// free-text parsing. See CLAUDE.md "Structured output".
//
// The gateway is deployment config, not code: OPENAI_API_KEY, OPENAI_BASE_URL, and
// OPENAI_MODEL are all required with no in-code fallback, so a misconfigured
// deployment fails loudly instead of silently hitting a baked-in default. The
// product line and areas come from the consuming repo's bot.yml.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { z } from "zod";
import type { Config } from "./config";

/** Entry classification, shown as a `**Label:**` prefix on the bullet. */
// User-facing types describe what a user notices; internal types describe
// maintenance work demoted to the Internal & maintenance section.
const TYPE_IDS = [
  "feature", "fix", "improvement", "performance", "breaking", "deprecation", "removal", "security",
  "refactor", "docs", "test", "chore", "ci", "build", "dependencies",
] as const;
const TYPE_LABELS: Record<string, string> = {
  feature: "Feature", feat: "Feature", new: "Feature",
  fix: "Fix", bugfix: "Fix", bug: "Fix",
  improvement: "Improvement", enhancement: "Improvement", improve: "Improvement",
  performance: "Performance", perf: "Performance",
  breaking: "Breaking",
  deprecation: "Deprecation", deprecated: "Deprecation",
  removal: "Removal", removed: "Removal", remove: "Removal",
  security: "Security",
  refactor: "Refactor", refactoring: "Refactor",
  docs: "Docs", doc: "Docs", documentation: "Docs",
  test: "Test", tests: "Test",
  chore: "Chore",
  ci: "CI",
  build: "Build",
  dependencies: "Dependencies", deps: "Dependencies", dependency: "Dependencies",
};

/** Canonical display label for a model-returned type, or "Change" if unknown. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type.trim().toLowerCase()] ?? "Change";
}

// Model families verified (live, 2026-06, OpenCode Go) to accept strict
// json_schema structured outputs. Everything else falls back to json_object.
const JSON_SCHEMA_MODEL_FAMILIES = ["mimo", "glm", "kimi"] as const;

/**
 * Whether OPENAI_MODEL accepts strict json_schema structured outputs.
 *
 * mimo / glm / kimi return HTTP 200 with a json_schema response_format; DeepSeek
 * V4 (`deepseek-*`) rejects it with "This response_format type is unavailable
 * now" and only supports json_object. Unknown models default to json_object too:
 * the safe path every model supports, with Output.object validating the result.
 * Add a family here only after verifying it accepts json_schema on the gateway.
 */
export function supportsJsonSchema(model: string): boolean {
  const m = model.trim().toLowerCase();
  return JSON_SCHEMA_MODEL_FAMILIES.some((f) => m === f || m.startsWith(`${f}-`));
}

/**
 * Sampling temperature for a model. We want 0 for determinism, but some gateway
 * models reject it: Moonshot's code models (`kimi-*-code`) return "invalid
 * temperature: only 1 is allowed for this model". Like supportsJsonSchema, this
 * is a hardcoded per-model gateway quirk; default 0, return 1 where required.
 */
export function temperatureFor(model: string): number {
  const m = model.trim().toLowerCase();
  return m.includes("kimi") && m.includes("code") ? 1 : 0;
}

export type ChangelogEntry = {
  area: string;
  type: string;
  short: string;
  medium: string;
  long: string;
};

export type ChangelogDraft = {
  entries: ChangelogEntry[];
};

/** Draft one entry per distinct change in a PR (never empty), each in three lengths. */
export async function draftChangelogOptions(
  config: Config,
  title: string,
  body: string,
  diff: string,
): Promise<ChangelogDraft> {
  const env = loadEnv();
  const provider = createOpenAICompatible({
    name: "openai",
    baseURL: env.OPENAI_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
    // Send strict json_schema only for models known to accept it; others fall
    // back to json_object (Output.object still validates). See supportsJsonSchema.
    supportsStructuredOutputs: supportsJsonSchema(env.OPENAI_MODEL),
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
    entries: z
      .array(entrySchema)
      .min(1)
      .describe("the fewest entries that capture what changed; usually exactly one; never empty (non-user-facing work goes in an internal entry, it is not skipped)"),
  });

  // json_object mode returns valid JSON but does not constrain it to the schema,
  // so Output.object can still reject it, and the model can return an empty
  // completion. A low temperature (temperatureFor: 0 where allowed) minimises
  // drift and a few retries cover both. The retryable failures are
  // NoOutputGeneratedError (Output.object got nothing parseable) and
  // NoObjectGeneratedError; real errors (auth, balance, the json_schema or
  // temperature rejections above, timeout) are neither and throw straight out.
  // The original "No output generated" CI failure was an uncaught
  // NoOutputGeneratedError that skipped this loop entirely.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema }),
        system: systemPrompt(config),
        prompt: userPrompt(title, body, diff),
        temperature: temperatureFor(env.OPENAI_MODEL),
        maxOutputTokens: 2048,
        abortSignal: AbortSignal.timeout(60_000),
      });
      return {
        entries: output.entries.map((e) => ({
          ...e,
          area: config.areas.resolve(e.area)?.id ?? config.areas.fallback.id,
        })),
      };
    } catch (error) {
      // Output.object throws NoOutputGeneratedError; generateObject-style paths
      // throw NoObjectGeneratedError. Both mean "no valid object this attempt" and
      // are retryable; anything else is a real error and propagates.
      if (!NoOutputGeneratedError.isInstance(error) && !NoObjectGeneratedError.isInstance(error)) throw error;
      lastError = error;
      const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
      const raw = NoObjectGeneratedError.isInstance(error) ? error.text : undefined;
      console.error(`draft attempt ${attempt + 1} produced no valid object`);
      console.error("  cause:", cause);
      console.error("  raw model response:", raw ?? "(none)");
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

// Structured outputs constrain the response to the schema, but a concrete example
// shape in the prompt still steers smaller models toward the right fields; this
// provides one (and names "json"), which is cheap belt-and-suspenders.
export function systemPrompt(config: Config): string {
  const exampleArea = config.areas.ids[0];
  return `You write changelog entries for ${config.product}.

From a PR title, description, and diff, produce the FEWEST entries that capture what changed, each in three lengths (short, medium, long). Default to exactly one entry. Add a second only when the PR ships two genuinely independent changes. EVERY PR gets at least one entry — never return an empty list, and never decline to document a change.

The description carries the author's intent and the user-facing "why"; the diff is ground truth for what actually changed. Use both. But do not copy internal rationale, design notes, alternatives considered, or test plans from the description into an entry.

Classify each entry as user-facing or internal:
- User-facing (a user of the product would notice the change): set "area" to the single best-fitting product area from [${config.areas.ids.filter((id) => id !== "internal").join(", ")}], and "type" to one of feature, fix, improvement, performance, breaking, deprecation, removal, security. fix means behavior a user relied on was broken and now works; do not call a refactor or internal hardening a "fix".
- Internal (no user-visible effect — refactors, tests, CI, build, chores, dependency bumps, and documentation): set "area" to "internal", and "type" to one of refactor, docs, test, chore, ci, build, dependencies. These are documented, just demoted; do not omit them. Host, runtime, and sandbox capabilities, plumbing, and workarounds that exist to support providers or other internal code are internal too, even though they touch the runtime — a user does not invoke them directly.

What counts as ONE entry:
- One change is one entry even when it touches several files, modules, or areas.
- A change that both adds something and removes what it replaced is one entry: describe the net result, not each half.
- Never split a change into multiple entries because it spans areas or has several internal steps.
- Internal plumbing that exists only to enable a user-facing change (a new capability, a helper, a workaround, a supporting refactor) is PART of that change's single user-facing entry, not its own entry. Describe the user-facing result; do not enumerate the mechanisms behind it.
- Most PRs produce one or two entries. Three or more is rare and almost always means you are splitting one change into its parts: collapse them.

Style:
- A user-facing entry is written for a reader skimming a changelog, not an engineer reading the diff. Lead with what they can now do, or what stopped breaking, in their own terms; prefer second person ("You can now..."), with the user as the subject rather than the system. For a fix, name the symptom that is gone, then the new behavior. Write natural sentences, one idea per clause; do not stack attributes into a single dense clause. State scope and limits as a plain caveat ("read-only for now"), not as plumbing.
- In ALL THREE lengths of a user-facing entry (short, medium, AND long), never use internal vocabulary: file or module names, extensions, internal paths, runtime or sandbox mechanisms, or wiring terms (for example "scheme", "token_file", "bind-mount", "WASM sandbox", "tokio"). The long form is prose for a person, not room for implementation detail. If something can only be said in those terms, leave it out.
- Internal entries are exempt from this voice: they may name the subsystem or module they touch, and should stay to one concise sentence.

Write a user-facing entry like the second example, never the first:
- Too dense, leaks mechanism: "A new db provider mounts a SQLite database into a navigable read-only filesystem; the host preopens directories into the WASM sandbox and works around a tokio handle conflict."
- Reader-first: "Browse a SQLite database as read-only files: the new db provider gives you a folder per table with its schema, indexes, row count, and a sample of its rows."

Example of collapsing one change: a PR that moves where a command keeps credentials, stops writing a token file, and reuses an existing import path is ONE user-facing entry ("you can now keep credentials in Y instead of the working tree"), not three.

Respond with JSON only, matching this shape:
{
  "entries": [
    { "area": "${exampleArea}", "type": "feature", "short": "one terse line", "medium": "one sentence", "long": "one or two sentences" }
  ]
}`;
}

export function userPrompt(title: string, body: string, diff: string): string {
  const MAX_DIFF = 60_000;
  const MAX_BODY = 8_000;
  const clipped = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n... [diff truncated]` : diff;
  const trimmed = body.trim();
  const description =
    trimmed.length === 0
      ? "(no description provided)"
      : trimmed.length > MAX_BODY
        ? `${trimmed.slice(0, MAX_BODY)}\n... [description truncated]`
        : trimmed;
  return `PR title: ${title}\n\nPR description:\n${description}\n\nUnified diff:\n${clipped}\n\nReturn the changelog entries as JSON.`;
}
