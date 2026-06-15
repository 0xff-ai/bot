# CLAUDE.md

Repository-local guidance for working in `0xff-ai/bot`.

This repo is a changelog bot for repositories that keep a [Keep a Changelog](https://keepachangelog.com/) `CHANGELOG.md`. It drafts an entry per PR with an LLM, lets the author or a maintainer finalize it with a `/changelog` comment, and commits the result to the PR's own branch so the entry merges with the change that introduced it. A merge gate (adopted from `dangoslen/changelog-enforcer`) blocks PRs that carry no entry. See `README.md` for the user-facing flow.

## Architecture in one breath

A bun/TypeScript CLI (`src/main.ts`) with two human-facing stages on `ChangelogBot` (`src/bot.ts`): `propose` runs on `pull_request` and posts the sticky proposal comment; `apply` runs on `issue_comment` and commits the chosen entry to the PR branch. GitHub reads/writes go through Octokit (`src/github.ts`); git working-tree operations are plain shell in `bot.ts`. The bot is generic; everything repo-specific comes from the consuming repo's `.github/bot.yml` (`src/config.ts`). It ships as a composite action (`action.yml`) plus a reusable workflow (`.github/workflows/changelog.yml`); a consumer adds a thin caller workflow and a `bot.yml`.

## Non-negotiables

These are invariants. A change that breaks one is wrong; if a task seems to require it, stop and surface it.

- **Additive changelog only.** The fold in `src/changelog.ts` never rewrites or reorders existing lines: it appends bullets under their area subsection, skips exact-text duplicates, and inserts a new area at its canonical position while leaving existing (possibly hand-reordered) subsections in place. Hand-edits to `CHANGELOG.md` must always survive, and re-applying the same entry must be a byte-level no-op. This is why the parser is line-based and non-normalizing, and why a parse-to-AST-and-reserialize library (`keep-a-changelog`, `remark`) is the wrong tool: it would reflow the file.
- **Config externalization.** Areas, the product description fed to the drafter, and the maintainer list are the consuming repo's vocabulary and live in `.github/bot.yml`, never hardcoded in the bot. Config parsing is strict (`src/config.ts`): unknown keys fail loudly so a typo surfaces instead of being ignored.
- **Authority boundary.** The bot commits `CHANGELOG.md` to a PR branch and never touches `main`. Fork PRs (the token can't push to a fork) get posted instructions, not a push. Do not widen this to push elsewhere or to mutate other files.
- **Untrusted input stays out of the shell.** PR comment bodies and other event fields are passed to the CLI as environment variables (`BOT_COMMENT_*`), never interpolated into a shell command. Git arguments go through Bun's `$` array interpolation, not string concatenation.
- **Structured output, always.** The drafter (`src/llm.ts`) uses structured output (`generateText` + `Output.object` + a Zod schema): the model returns JSON and `Output.object` validates it against the schema. Never "fix" a drafting failure by removing `Output.object` and parsing free text yourself: that silently drops the schema guarantee and is the wrong call. Debug the structured-output path instead. What was learned debugging the OpenCode Go gateway (live, 2026-06):
  - **json_schema support is per-model, and hardcoded in `supportsJsonSchema`** (not an env var). Models matched there (`mimo*`, `glm*`, `kimi*`) get a strict `json_schema` response_format (`supportsStructuredOutputs: true`); everything else uses `json_object`. Extend that list only after verifying a model returns HTTP 200 to a `json_schema` request on the gateway.
  - **DeepSeek V4 does not support json_schema.** `deepseek-v4-flash`/`-pro` reject it with `This response_format type is unavailable now` and support only `json_object`. The benign `JSON response format schema is only supported with structuredOutputs` warning on those models is expected, not the failure. Verified the limitation is the **model**, not the endpoint: the same gateway returns 200 for json_schema on `mimo-v2.5`, `glm-5.1`, and `kimi-k2.6`.
  - **json_object is the safe universal fallback.** Every model supports it, and `Output.object` validates the returned JSON against the schema, so unknown models default to it and still get validation (just not strict server-side enforcement).
  - **The original failure** (the `propose` exit 1, "No output generated") was an uncaught `NoOutputGeneratedError` from a transient empty completion: `Output.object` throws `NoOutputGeneratedError`, but the retry loop only caught `NoObjectGeneratedError`, so it skipped the retries and hard-exited. The loop must catch **both**.
  - To verify a model end-to-end, run the real `draftChangelogOptions` against the gateway with the token from `~/.pi/agent/auth.json` (`opencode-go.key`), `OPENAI_BASE_URL=https://opencode.ai/zen/go/v1`; never print the token.

## Working in this repo

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # bun:test
```

Tests cover the pure logic that is easy to get wrong and easy to regress: the `/changelog` grammar (`src/command.test.ts`), the additive fold and Keep-a-Changelog parse (`src/changelog.test.ts`), the proposal data-block round-trip (`src/comment.test.ts`), and strict config parsing (`src/config.test.ts`). The Octokit and git integration runs only against a live repo, so it is exercised by CI, not unit-tested; do not add fake-GitHub tests that only assert the mock.

## Layout

| File | Role |
|---|---|
| `src/main.ts` | CLI entry: `propose` / `apply`, builds config + Octokit |
| `src/bot.ts` | `ChangelogBot`: the two stages, branch commit, fork instructions |
| `src/github.ts` | Octokit wrapper (`GitHub.fromEnv()`) |
| `src/changelog.ts` | Keep a Changelog parse + additive area fold |
| `src/command.ts` | `/changelog` comment grammar |
| `src/comment.ts` | Sticky proposal render + hidden data block |
| `src/config.ts` / `src/areas.ts` | `.github/bot.yml` load + the areas view over it |
| `src/llm.ts` | Structured draft via the AI SDK |
| `action.yml`, `.github/workflows/changelog.yml` | Composite action + reusable workflow |

## Conventions

- Smallest correct change; match the surrounding style. Comments explain why, not what.
- Dependencies are justified, not reflexive: a new dep must remove real custom code or fix a correctness gap, not just be popular. The current set earns its place (Octokit for typed GitHub access, the `ai` SDK + `zod` for structured drafting, `yaml` + `zod` for strict config, `ts-pattern` for exhaustive command dispatch). Adding a lodash-style toolkit was rejected: the collection ops here are one-line stdlib, and the one dense site is order-preserving by design.
- The WIT-style flag day here is `bot.yml` and the `/changelog` grammar: both are a contract consumers depend on. Treat changes to the config schema or the command syntax as breaking, and update `README.md` and `bot.example.yml` in the same change.
- The reusable workflow references the action by tag (`0xff-ai/bot@v1`). A breaking change to inputs or behavior needs a new major tag, not a silent move of `v1`.
