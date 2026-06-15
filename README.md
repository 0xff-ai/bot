# 0xff-ai/bot

A changelog bot for repos that keep a [Keep a Changelog](https://keepachangelog.com/) `CHANGELOG.md`. It drafts an entry per PR with an LLM, lets the author or a maintainer finalize it with a comment, and commits the result to the PR's own branch so the entry merges with the change that introduced it. A merge gate keeps PRs honest.

## How it works

- **Propose** (on `pull_request`): unless the PR already edits `CHANGELOG.md`, the bot drafts one entry in three lengths and posts a sticky comment. A no-user-facing-change PR is labeled `no-changelog` automatically.
- **Apply** (on `issue_comment`): the author or a maintainer replies with a `/changelog` command and the bot commits the entry to the PR branch under its area heading. Fork PRs can't be pushed to, so the bot posts the exact commands a maintainer runs locally.
- **Gate** (on `pull_request`): [`dangoslen/changelog-enforcer`](https://github.com/dangoslen/changelog-enforcer) fails the PR until `CHANGELOG.md` changes, with the `no-changelog` label as the escape hatch.

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
3. Add the org-level secret `OPENCODE_ZEN_API_KEY` (drafting; override the model/endpoint with `OMNIFS_RELEASE_NOTES_MODEL` / `OMNIFS_RELEASE_NOTES_BASE_URL`).
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

5. Add the `changelog-enforcer` check (the `gate` job) to the branch's required status checks so it actually blocks merge.

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
