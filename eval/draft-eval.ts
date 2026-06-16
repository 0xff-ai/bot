#!/usr/bin/env bun
//
// Local model-comparison harness for the changelog drafter. NOT part of the
// action or CI: it answers "which gateway model drafts the cleanest entries for
// this prompt" empirically, by running the real `draftChangelogOptions` over a
// set of PR fixtures across several OPENAI_MODEL values and scoring the output.
//
// It reuses the production drafting path (no mock model), and sources the
// OpenCode Go token the way CLAUDE.md documents: from ~/.pi/agent/auth.json
// (`opencode-go.key`), base URL https://opencode.ai/zen/go/v1. The token is
// never printed. Override with OPENAI_API_KEY / OPENAI_BASE_URL in the env.
//
// Every run writes a browsable record under --out (default eval/out/):
//   pr-<n>.input.md         the exact system + user prompt fed to every model
//   pr-<n>.<model>.json     that model's full draft (or error + raw text)
//   summary.md              the comparison table
//
// Usage:
//   bun eval/draft-eval.ts                          # all cases.json, default models
//   bun eval/draft-eval.ts --models mimo-v2.5,glm-5.1
//   bun eval/draft-eval.ts --pr 124 --repo 0xff-ai/omnifs --title "..."

import { $ } from "bun";
import { NoObjectGeneratedError } from "ai";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli";
import { parseConfig, type Config } from "../src/config";
import {
  draftChangelogOptions,
  systemPrompt,
  typeLabel,
  userPrompt,
  type ChangelogDraft,
} from "../src/llm";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
const DEFAULT_MODELS = ["mimo-v2.5", "glm-5.1", "kimi-k2.6"];

type Case = { repo: string; pr: number; title: string; expect?: string };

// Implementation vocabulary that should never reach an end-user changelog line.
// Hits are advisory: they flag a leak for the eye, they don't fail a run.
const JARGON: { re: RegExp; label: string }[] = [
  { re: /\/run\/secrets/i, label: "/run/secrets" },
  { re: /\btoken_file\b/i, label: "token_file" },
  { re: /\btoken_env\b/i, label: "token_env" },
  { re: /bind[-\s]?mount/i, label: "bind-mount" },
  { re: /detect[-\s]?validate[-\s]?store/i, label: "detect-validate-store" },
  { re: /\bmaterializ/i, label: "materialize" },
  { re: /\bby scheme\b/i, label: "by-scheme" },
  { re: /\bschemes?\b/i, label: "scheme" },
  { re: /\bdev[-\s]?mount/i, label: "dev-mount" },
  { re: /\.(rs|ts|toml)\b/i, label: "source-file-ext" },
  { re: /credential (store|file)/i, label: "credential-store/file" },
];

function loadToken(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const auth = JSON.parse(readFileSync(join(homedir(), ".pi/agent/auth.json"), "utf8"));
  const key = auth["opencode-go"]?.key ?? auth["opencode-go.key"];
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("no opencode-go token in ~/.pi/agent/auth.json and OPENAI_API_KEY unset");
  }
  return key;
}

function jargonHits(draft: ChangelogDraft): string[] {
  // Only user-facing entries must avoid internal vocabulary; internal entries
  // are allowed to name the subsystem they touch.
  const text = draft.entries
    .filter((e) => e.area !== "internal")
    .map((e) => `${e.short} ${e.medium} ${e.long}`)
    .join(" ");
  return JARGON.filter((j) => j.re.test(text)).map((j) => j.label);
}

type RowResult =
  | { model: string; ok: true; draft: ChangelogDraft; jargon: string[]; ms: number }
  | { model: string; ok: false; error: string; raw?: string; ms: number };

async function run() {
  const { values } = parseArgs(Bun.argv.slice(2), {
    models: { type: "string" },
    cases: { type: "string" },
    config: { type: "string" },
    repo: { type: "string" },
    pr: { type: "string" },
    title: { type: "string" },
    out: { type: "string" },
  });

  const models = (values.models ?? DEFAULT_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
  const configPath = values.config ?? join(import.meta.dir, "bot.yml");
  const config: Config = parseConfig(await Bun.file(configPath).text());
  const outDir = values.out ?? join(import.meta.dir, "out");

  let cases: Case[];
  if (values.pr) {
    cases = [{ repo: values.repo ?? "0xff-ai/omnifs", pr: Number(values.pr), title: values.title ?? `PR #${values.pr}` }];
  } else {
    const casesPath = values.cases ?? join(import.meta.dir, "cases.json");
    cases = JSON.parse(await Bun.file(casesPath).text());
  }

  process.env.OPENAI_API_KEY = loadToken();
  process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;

  console.log(`product: ${config.product}`);
  console.log(`models:  ${models.join(", ")}`);
  console.log(`gateway: ${process.env.OPENAI_BASE_URL}`);
  console.log(`out:     ${outDir}\n`);

  const summary: string[] = [`# Changelog drafter — model comparison\n`, `product: ${config.product}\n`];

  for (const c of cases) {
    console.log("━".repeat(96));
    console.log(`PR #${c.pr} — ${c.title}`);
    if (c.expect) console.log(`  expect: ${c.expect}`);
    console.log("");

    // GitHub returns HTTP 406 for diffs over 20k lines, and the production bot
    // hits the same wall. When that happens, fall back to the changed-file list
    // so the drafter still has the title + description + file shape to work from
    // (a useful test of how far the PR description alone carries an entry).
    const diffRes = await $`gh pr diff ${c.pr} --repo ${c.repo}`.nothrow().quiet();
    let diff = diffRes.exitCode === 0 ? diffRes.stdout.toString().trim() : "";
    if (diff.length === 0) {
      const files = (await $`gh pr view ${c.pr} --repo ${c.repo} --json files --jq ${".files[].path"}`.nothrow().quiet()).stdout.toString().trim();
      if (files.length === 0) {
        console.log("  (no diff and no file list; skipping)\n");
        continue;
      }
      console.log("  (full diff unavailable — too large; using changed-file list + description)");
      diff = `[Full unified diff unavailable for this PR — it exceeds GitHub's API line limit. Changed files:]\n${files}`;
    }
    const body = (await $`gh pr view ${c.pr} --repo ${c.repo} --json body --jq ${".body"}`.nothrow().quiet()).stdout.toString().trim();

    // Persist the EXACT messages fed to every model for this case (identical
    // across models). userPrompt does the diff/description clipping, so this is
    // byte-for-byte what the gateway received.
    const input = [
      `# PR #${c.pr} — ${c.title}`,
      c.expect ? `\n> expect: ${c.expect}` : "",
      `\nFed identically to every model below.\n`,
      `## System prompt\n\n\`\`\`\n${systemPrompt(config)}\n\`\`\`\n`,
      `## User prompt\n\n\`\`\`\n${userPrompt(c.title, body, diff)}\n\`\`\`\n`,
    ].join("\n");
    await Bun.write(join(outDir, `pr-${c.pr}.input.md`), input);

    summary.push(`\n## PR #${c.pr} — ${c.title}`);
    if (c.expect) summary.push(`_expect: ${c.expect}_`);
    summary.push(`\n| model | result | types/areas | jargon | ms |`, `|---|---|---|---|---|`);

    for (const model of models) {
      process.env.OPENAI_MODEL = model;
      const started = Date.now();
      let row: RowResult;
      try {
        const draft = await draftChangelogOptions(config, c.title, body, diff);
        row = { model, ok: true, draft, jargon: jargonHits(draft), ms: Date.now() - started };
      } catch (error) {
        const raw = NoObjectGeneratedError.isInstance(error) ? error.text : undefined;
        row = { model, ok: false, error: error instanceof Error ? error.message : String(error), raw, ms: Date.now() - started };
      }

      // Full per-(case,model) record on disk.
      await Bun.write(join(outDir, `pr-${c.pr}.${model}.json`), JSON.stringify(row, null, 2));

      // Console + summary line.
      if (row.ok) {
        const n = row.draft.entries.length;
        const types = row.draft.entries.map((e) => `${typeLabel(e.type)}/${e.area}`).join(", ");
        const flag = `${n} ${n === 1 ? "entry" : "entries"}`;
        console.log(`  ${model.padEnd(16)} ${flag.padEnd(10)} ${types.padEnd(34)} jargon:${row.jargon.length ? row.jargon.join(",") : "none"}  ${row.ms}ms`);
        for (const e of row.draft.entries) console.log(`      · ${e.medium}`);
        summary.push(`| ${model} | ${flag} | ${types || "—"} | ${row.jargon.join(",") || "none"} | ${row.ms} |`);
      } else {
        console.log(`  ${model.padEnd(16)} ERROR  ${row.error}`);
        summary.push(`| ${model} | ERROR | ${row.error} | — | ${row.ms} |`);
      }
    }
    console.log("");
  }

  await Bun.write(join(outDir, "summary.md"), `${summary.join("\n")}\n`);
  console.log(`Wrote inputs, per-model outputs, and summary.md to ${outDir}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
