// The changelog bot has two human-facing stages:
//
//   propose(pr):  on a feature PR, draft one entry in three lengths and post it as
//                 a sticky comment. Skipped when the PR already edits CHANGELOG.md
//                 (the author wrote their own). A no-user-facing-change PR gets the
//                 `no-changelog` label so the merge gate passes.
//
//   apply(pr):    when the author or a maintainer comments `/changelog ...`, commit
//                 the chosen entry to the PR's own branch under its area heading.
//                 Fork PRs can't be pushed to, so the bot posts the exact commands
//                 a maintainer runs locally instead.
//
// The merge gate (requiring CHANGELOG.md to change, with `no-changelog` as the
// escape hatch) is enforced by dangoslen/changelog-enforcer in the workflow, not
// here.

import { match } from "ts-pattern";
import { appendBulletsToUnreleased, parseChangelog, withUnreleased } from "./changelog";
import { parseCommand, type Command } from "./command";
import { MARKER, parseProposalData, renderProposal } from "./comment";
import type { Config } from "./config";
import type { GitHub } from "./github";
import { draftChangelogOptions, type ChangelogDraft } from "./llm";
import type { Repo } from "./repo";

const CHANGELOG = "CHANGELOG.md";
const COMMIT_PREFIX = "docs(changelog):";
const SKIP_LABEL = "no-changelog";
const SKIP_LABEL_DESC = "No changelog entry required for this PR";
const PRIVILEGED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export type CommentContext = { body: string; author: string; association: string };
type Entry = { area: string; text: string };

export class ChangelogBot {
  constructor(
    private readonly repo: Repo,
    private readonly config: Config,
    private readonly github: GitHub,
  ) {}

  /** PR stage: draft the entry and post the sticky proposal comment. */
  async propose(pr: number): Promise<void> {
    if (await this.changelogTouched(pr)) {
      console.log(`#${pr}: PR already edits ${CHANGELOG}; nothing to propose`);
      return;
    }
    if (!process.env.OPENCODE_ZEN_API_KEY) {
      // Fork PRs cannot read the secret; a maintainer can still apply at review.
      console.log(`#${pr}: no OPENCODE_ZEN_API_KEY (likely a fork PR); skipping draft`);
      return;
    }
    if (await this.github.findComment(pr, MARKER)) {
      console.log(`#${pr}: proposal comment exists; leaving it intact`);
      return;
    }
    const title = await this.github.prTitle(pr);
    const diff = await this.github.prDiff(pr);
    const draft = await draftChangelogOptions(this.config, title, diff);
    if (draft.skip) {
      await this.label(pr);
      await this.github.upsertComment(pr, MARKER, renderProposal(draft, this.config.areas));
      console.log(`#${pr}: no user-facing change; labeled ${SKIP_LABEL}`);
      return;
    }
    await this.github.upsertComment(pr, MARKER, renderProposal(draft, this.config.areas));
    console.log(`#${pr}: posted changelog proposal under ${draft.area}`);
  }

  /** Comment stage: act on a `/changelog ...` command from an authorized user. */
  async apply(pr: number, ctx: CommentContext): Promise<void> {
    const command = parseCommand(ctx.body, this.config.areas);
    if (!command) return; // not a /changelog command
    if (!(await this.authorized(pr, ctx))) {
      console.log(`#${pr}: ${ctx.author} not authorized to apply a changelog entry; ignoring`);
      return;
    }
    if (command.kind === "skip") {
      await this.label(pr);
      await this.github.postComment(pr, `Labeled \`${SKIP_LABEL}\`: no changelog entry needed.`);
      return;
    }
    const entry = await this.resolveEntry(pr, command);
    if (!entry) {
      await this.github.postComment(
        pr,
        "Couldn't resolve a changelog entry from that command. Try `/changelog apply` or `/changelog <area>: your text`.",
      );
      return;
    }
    const head = await this.github.prHead(pr);
    if (head.isCrossRepository) {
      await this.github.postComment(pr, this.forkInstructions(pr, entry));
      console.log(`#${pr}: fork PR; posted manual apply instructions`);
      return;
    }
    await this.commitToBranch(pr, head.ref, entry, ctx.author);
  }

  private async resolveEntry(
    pr: number,
    command: Exclude<Command, { kind: "skip" }>,
  ): Promise<Entry | undefined> {
    const draft = await this.recoverDraft(pr);
    return match(command)
      .with({ kind: "length" }, (c) => {
        if (!draft || draft.skip) return undefined;
        const text = draft[c.length].trim();
        return text.length > 0 ? { area: draft.area, text } : undefined;
      })
      .with({ kind: "text" }, (c) => {
        const text = c.text.trim();
        if (text.length === 0) return undefined;
        const area = c.area ?? draft?.area ?? this.config.areas.fallback.id;
        return { area, text };
      })
      .exhaustive();
  }

  private async recoverDraft(pr: number): Promise<ChangelogDraft | undefined> {
    const comment = await this.github.findComment(pr, MARKER);
    return comment ? parseProposalData(comment.body) : undefined;
  }

  private async commitToBranch(pr: number, ref: string, entry: Entry, author: string): Promise<void> {
    await this.repo.$`git fetch origin ${ref}`.quiet();
    await this.repo.$`git checkout -B ${ref} FETCH_HEAD`.quiet();
    const log = parseChangelog(await Bun.file(this.repo.path(CHANGELOG)).text());
    const body = appendBulletsToUnreleased(
      log.unreleasedBody,
      [{ area: entry.area, text: entry.text }],
      this.config.areas,
    );
    if (body === log.unreleasedBody) {
      await this.github.postComment(pr, "That entry is already in `CHANGELOG.md`; nothing to add.");
      return;
    }
    await Bun.write(this.repo.path(CHANGELOG), withUnreleased(log, body).raw);
    const id = await this.github.userIdentity(author);
    await this.repo.$`git add ${CHANGELOG}`;
    await this.repo.$`git commit -m ${`${COMMIT_PREFIX} add entry for #${pr}`} --author=${`${id.name} <${id.email}>`}`;
    await this.repo.$`git push origin HEAD:${ref}`;
    await this.github.postComment(
      pr,
      `Added a changelog entry under **${this.config.areas.byId(entry.area).heading}**.`,
    );
    console.log(`#${pr}: committed changelog entry under ${entry.area}`);
  }

  private forkInstructions(pr: number, entry: Entry): string {
    const heading = this.config.areas.byId(entry.area).heading;
    return [
      "This PR is from a fork, so I can't push to its branch. A maintainer with the PR checked out can add the entry locally:",
      "",
      "```bash",
      `gh pr checkout ${pr}`,
      `# under "### ${heading}" in CHANGELOG.md's [Unreleased] section, add:`,
      `#   - ${entry.text}`,
      "git add CHANGELOG.md",
      `git commit -m "${COMMIT_PREFIX} add entry for #${pr}"`,
      "git push",
      "```",
    ].join("\n");
  }

  private async authorized(pr: number, ctx: CommentContext): Promise<boolean> {
    if (PRIVILEGED.has(ctx.association.toUpperCase())) return true;
    if (this.config.maintainers.includes(ctx.author)) return true;
    return ctx.author === (await this.github.prAuthorLogin(pr));
  }

  private async changelogTouched(pr: number): Promise<boolean> {
    return (await this.github.prChangedFiles(pr)).includes(CHANGELOG);
  }

  private async label(pr: number): Promise<void> {
    await this.github.ensureLabel(SKIP_LABEL, SKIP_LABEL_DESC);
    await this.github.addLabel(pr, SKIP_LABEL);
  }
}
