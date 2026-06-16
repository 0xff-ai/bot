// The changelog bot has two human-facing stages:
//
//   propose(pr):  on every PR, draft at least one entry (each typed and area-
//                 classified, in three lengths) and post them as a sticky comment.
//                 Nothing is skipped: non-user-facing work (refactors, tests, CI,
//                 chores, deps, docs) is documented under the bot-owned Internal &
//                 maintenance area instead. Skipped only when the PR already edits
//                 CHANGELOG.md. A maintainer can still force-skip with the manual
//                 `/changelog skip` command (the `no-changelog` label).
//
//   apply(pr):    when the author or a maintainer comments `/changelog ...`, commit
//                 the chosen entries to the PR's own branch under their areas. Fork
//                 PRs can't be pushed to, so the bot posts the commands to run.
//
// The merge gate is reported by gate() as the `changelog` check (see that method).

import { match } from "ts-pattern";
import { appendBulletsToUnreleased, parseChangelog, withUnreleased } from "./changelog";
import { parseCommand, type Command } from "./command";
import { MARKER, parseProposalData, renderProposal } from "./comment";
import type { Config } from "./config";
import type { GitHub } from "./github";
import { draftChangelogOptions, typeLabel, type ChangelogDraft } from "./llm";
import type { Repo } from "./repo";
import { stampEntry } from "./stamp";

const CHANGELOG = "CHANGELOG.md";
const COMMIT_PREFIX = "docs(changelog):";
const SKIP_LABEL = "no-changelog";
const SKIP_LABEL_DESC = "No changelog entry required for this PR";
const PRIVILEGED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export type CommentContext = { body: string; author: string; association: string };
type Bullet = { area: string; text: string };

export class ChangelogBot {
  constructor(
    private readonly repo: Repo,
    private readonly config: Config,
    private readonly github: GitHub,
  ) {}

  /** PR stage: draft the entries and post the sticky proposal comment. */
  async propose(pr: number): Promise<void> {
    if (await this.changelogTouched(pr)) {
      console.log(`#${pr}: PR already edits ${CHANGELOG}; nothing to propose`);
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      // Fork PRs cannot read the secret; a maintainer can still apply at review.
      console.log(`#${pr}: no OPENAI_API_KEY (likely a fork PR); skipping draft`);
      return;
    }
    if (await this.github.findComment(pr, MARKER)) {
      console.log(`#${pr}: proposal comment exists; leaving it intact`);
      return;
    }
    const { title, body } = await this.github.prMeta(pr);
    const diff = await this.github.prDiff(pr);
    const draft = await draftChangelogOptions(this.config, title, body, diff);
    await this.github.upsertComment(pr, MARKER, renderProposal(draft, this.config.areas));
    console.log(`#${pr}: posted changelog proposal with ${draft.entries.length} entr${draft.entries.length === 1 ? "y" : "ies"}`);
  }

  /**
   * Gate: report the `changelog` check on the PR head. Blocks merge with an
   * orange `action_required` (not a red failure) until CHANGELOG.md changes or the
   * `no-changelog` label is set.
   */
  async gate(pr: number, headSha: string): Promise<void> {
    const satisfied =
      (await this.github.prChangedFiles(pr)).includes(CHANGELOG) ||
      (await this.github.hasLabel(pr, SKIP_LABEL));
    if (satisfied) {
      await this.github.reportCheck("changelog", headSha, "success", "Changelog entry present", "This PR updates CHANGELOG.md (or carries the `no-changelog` label).");
      console.log(`#${pr}: changelog present; gate satisfied`);
      return;
    }
    await this.github.reportCheck(
      "changelog",
      headSha,
      "action_required",
      "Changelog entry required",
      "Add one by commenting `/changelog apply` (or `/changelog short`/`long` to pick a length), or apply the `no-changelog` label. Merge stays blocked until then.",
    );
    console.log(`#${pr}: changelog missing; gate set to action_required`);
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
    const bullets = await this.resolveBullets(pr, command);
    if (bullets.length === 0) {
      await this.github.postComment(
        pr,
        "Couldn't resolve a changelog entry from that command. Try `/changelog [short|med|long]` or `/changelog <area>: your text`.",
      );
      return;
    }
    // Stamp each bullet with `(#pr)`, crediting the PR author when they are not a
    // maintainer. The credit is the contributor, not the commenter applying it.
    const prAuthor = await this.github.prAuthorLogin(pr);
    const stamped = bullets.map((b) => ({ ...b, text: stampEntry(b.text, pr, prAuthor, this.config.maintainers) }));
    const head = await this.github.prHead(pr);
    if (head.isCrossRepository) {
      await this.github.postComment(pr, this.forkInstructions(pr, stamped));
      console.log(`#${pr}: fork PR; posted manual apply instructions`);
      return;
    }
    await this.commitToBranch(pr, head.ref, stamped, ctx.author);
  }

  private async resolveBullets(pr: number, command: Exclude<Command, { kind: "skip" }>): Promise<Bullet[]> {
    const draft = await this.recoverDraft(pr);
    return match(command)
      .with({ kind: "length" }, (c) => {
        if (!draft) return [];
        return draft.entries
          .map((e) => {
            const text = e[c.length].trim();
            return text.length > 0 ? { area: e.area, text: `**${typeLabel(e.type)}:** ${text}` } : undefined;
          })
          .filter((b): b is Bullet => b !== undefined);
      })
      .with({ kind: "text" }, (c) => {
        const text = c.text.trim();
        if (text.length === 0) return [];
        const area = c.area ?? draft?.entries[0]?.area ?? this.config.areas.fallback.id;
        return [{ area, text }];
      })
      .exhaustive();
  }

  private async recoverDraft(pr: number): Promise<ChangelogDraft | undefined> {
    const comment = await this.github.findComment(pr, MARKER);
    return comment ? parseProposalData(comment.body) : undefined;
  }

  private async commitToBranch(pr: number, ref: string, bullets: Bullet[], author: string): Promise<void> {
    await this.repo.$`git fetch origin ${ref}`.quiet();
    await this.repo.$`git checkout -B ${ref} FETCH_HEAD`.quiet();
    const log = parseChangelog(await Bun.file(this.repo.path(CHANGELOG)).text());
    const body = appendBulletsToUnreleased(log.unreleasedBody, bullets, this.config.areas);
    if (body === log.unreleasedBody) {
      await this.github.postComment(pr, "Those entries are already in `CHANGELOG.md`; nothing to add.");
      return;
    }
    await Bun.write(this.repo.path(CHANGELOG), withUnreleased(log, body).raw);
    const id = await this.github.userIdentity(author);
    await this.repo.$`git add ${CHANGELOG}`;
    await this.repo.$`git commit -m ${`${COMMIT_PREFIX} add ${bullets.length === 1 ? "entry" : "entries"} for #${pr}`} --author=${`${id.name} <${id.email}>`}`;
    await this.repo.$`git push origin HEAD:${ref}`;
    const areas = [...new Set(bullets.map((b) => this.config.areas.byId(b.area).heading))].join(", ");
    await this.github.postComment(
      pr,
      `Added ${bullets.length} changelog ${bullets.length === 1 ? "entry" : "entries"} (${areas}).`,
    );
    console.log(`#${pr}: committed ${bullets.length} changelog ${bullets.length === 1 ? "entry" : "entries"}`);
  }

  private forkInstructions(pr: number, bullets: Bullet[]): string {
    const lines = bullets.map((b) => `#   under "### ${this.config.areas.byId(b.area).heading}":  - ${b.text}`);
    return [
      "This PR is from a fork, so I can't push to its branch. A maintainer with the PR checked out can add the entries locally:",
      "",
      "```bash",
      `gh pr checkout ${pr}`,
      "# in CHANGELOG.md's [Unreleased] section, add:",
      ...lines,
      "git add CHANGELOG.md",
      `git commit -m "${COMMIT_PREFIX} add entries for #${pr}"`,
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
