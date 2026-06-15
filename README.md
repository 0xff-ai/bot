# 0xff-ai/bot

A changelog bot for repos that keep a [Keep a Changelog](https://keepachangelog.com/) `CHANGELOG.md`. It drafts an entry per PR with an LLM, lets the author or a maintainer finalize it with a comment, and commits the result to the PR's own branch so the entry merges with the change that introduced it. A merge gate keeps PRs honest.

## How it works

- **Propose** (on `pull_request`): unless the PR already edits `CHANGELOG.md`, the bot drafts one entry in three lengths and posts a sticky comment. A no-user-facing-change PR is labeled `no-changelog` automatically.
- **Apply** (on `issue_comment`): the author or a maintainer replies with a `/changelog` command and the bot commits the entry to the PR branch under its area heading. Fork PRs can't be pushed to, so the bot posts the exact commands a maintainer runs locally.
- **Gate** (on `pull_request`): reports a `changelog` check that blocks merge until `CHANGELOG.md` changes (or the `no-changelog` label is set). It uses an `action_required` conclusion, so a missing entry shows as an orange "action required" state rather than a red failure.

The entry is added additively under its `### <area>` subsection: existing lines are never rewritten, so hand-edits survive and re-applying the same entry is a no-op.

## Commands

| Comment | Effect |
|---|---|
| `/changelog apply` | Add the drafted medium entry |
| `/changelog apply short` / `long` | Add a specific drafted length |
| `/changelog <area>: your wording` | Add custom text under an area |
| `/changelog skip` | Label `no-changelog`; no entry needed |

Only the PR author or a maintainer (repo owner/member/collaborator, or a login in `maintainers`) can apply. Anyone can instead just edit `CHANGELOG.md` directly.

## Adopting it in a repo

1. Add `.github/bot.yml` (see [`bot.example.yml`](./bot.example.yml)): the `product` line, `maintainers`, and the changelog `areas`.
2. Ensure `CHANGELOG.md` has a `## [Unreleased]` section.
3. Configure the drafter (all required, no defaults): the secret `OPENAI_API_KEY`, plus `OPENAI_BASE_URL` and `OPENAI_MODEL` set as either secrets or repo/org variables. For OpenCode Zen Go: `OPENAI_BASE_URL=https://opencode.ai/zen/go/v1`, `OPENAI_MODEL=deepseek-v4-flash`.
4. Add the caller workflow `.github/workflows/changelog.yml`:

   ```yaml
   name: Changelog
   on:
     pull_request:
       types: [opened, reopened, synchronize, labeled, unlabeled]
     issue_comment:
       types: [created]
   jobs:
     changelog:
       uses: 0xff-ai/bot/.github/workflows/changelog.yml@v1
       secrets: inherit
   ```

5. Add the **`changelog`** check (reported by the `gate` job) to the branch's required status checks so it actually blocks merge. The job itself stays green; the `changelog` check is what blocks, as an orange `action_required` until an entry exists.

## Config (`.github/bot.yml`)

```yaml
product: <one-line product description fed to the drafter>
maintainers: [<login>, ...]
areas:
  - id: <slug>
    heading: <### heading written into CHANGELOG.md>
    aliases: [<synonym>, ...]   # optional
```

Areas are ordered; the last is the catch-all. Parsing is strict: unknown keys fail.

## Development

```bash
bun install
bun run typecheck
bun test
```
