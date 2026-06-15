// Typed GitHub REST access via Octokit (@actions/github). Runs inside GitHub
// Actions: the token comes from the workflow (GITHUB_TOKEN) and owner/repo from
// the GITHUB_REPOSITORY context. Kept narrow: read a PR's title/diff/author and
// changed files, detect a fork PR, manage the sticky proposal comment, post
// replies, and toggle the skip label. Git working-tree operations live in bot.ts.

import { context, getOctokit } from "@actions/github";

type Octokit = ReturnType<typeof getOctokit>;

export type Comment = { id: number; body: string };
export type UserIdentity = { login: string; name: string; email: string };
export type PrHead = { ref: string; repo: string; isCrossRepository: boolean };

export class GitHub {
  private constructor(
    private readonly api: Octokit,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  static fromEnv(): GitHub {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN is not set");
    const { owner, repo } = context.repo;
    return new GitHub(getOctokit(token), owner, repo);
  }

  private get base() {
    return { owner: this.owner, repo: this.repo };
  }

  async prTitle(number: number): Promise<string> {
    const { data } = await this.api.rest.pulls.get({ ...this.base, pull_number: number });
    return data.title;
  }

  async prDiff(number: number): Promise<string> {
    const res = await this.api.rest.pulls.get({
      ...this.base,
      pull_number: number,
      mediaType: { format: "diff" },
    });
    // With the diff media type the response body is the unified diff text.
    return res.data as unknown as string;
  }

  async prAuthorLogin(number: number): Promise<string> {
    const { data } = await this.api.rest.pulls.get({ ...this.base, pull_number: number });
    return data.user?.login ?? "";
  }

  /** Paths the PR changes, relative to the repo root. */
  async prChangedFiles(number: number): Promise<string[]> {
    const files = await this.api.paginate(this.api.rest.pulls.listFiles, {
      ...this.base,
      pull_number: number,
      per_page: 100,
    });
    return files.map((f) => f.filename);
  }

  /** Head ref and repo, and whether the PR comes from a fork (cross-repository). */
  async prHead(number: number): Promise<PrHead> {
    const { data } = await this.api.rest.pulls.get({ ...this.base, pull_number: number });
    const headRepo = data.head.repo?.full_name ?? "";
    return {
      ref: data.head.ref,
      repo: headRepo,
      isCrossRepository: headRepo !== `${this.owner}/${this.repo}`,
    };
  }

  /**
   * Resolve a login to a git identity. Uses GitHub's no-reply email form
   * (`ID+login@users.noreply.github.com`) so the changelog commit can be authored
   * as the contributor without exposing a private address.
   */
  async userIdentity(login: string): Promise<UserIdentity> {
    const { data } = await this.api.rest.users.getByUsername({ username: login });
    return {
      login: data.login,
      name: data.name && data.name.length > 0 ? data.name : data.login,
      email: `${data.id}+${data.login}@users.noreply.github.com`,
    };
  }

  /** First issue comment carrying `marker`, or undefined. */
  async findComment(number: number, marker: string): Promise<Comment | undefined> {
    const comments = await this.api.paginate(this.api.rest.issues.listComments, {
      ...this.base,
      issue_number: number,
      per_page: 100,
    });
    const found = comments.find((c) => (c.body ?? "").includes(marker));
    return found ? { id: found.id, body: found.body ?? "" } : undefined;
  }

  /** Create the sticky comment, or edit it in place. Returns the comment id. */
  async upsertComment(number: number, marker: string, body: string): Promise<number> {
    const existing = await this.findComment(number, marker);
    if (existing) {
      await this.api.rest.issues.updateComment({ ...this.base, comment_id: existing.id, body });
      return existing.id;
    }
    const { data } = await this.api.rest.issues.createComment({ ...this.base, issue_number: number, body });
    return data.id;
  }

  /** Post a fresh comment (a reply, not the sticky proposal). */
  async postComment(number: number, body: string): Promise<void> {
    await this.api.rest.issues.createComment({ ...this.base, issue_number: number, body });
  }

  /** Create the label if absent; idempotent. */
  async ensureLabel(name: string, description: string): Promise<void> {
    try {
      await this.api.rest.issues.createLabel({ ...this.base, name, color: "ededed", description });
    } catch (error) {
      // 422 means the label already exists; anything else is a real failure.
      if ((error as { status?: number }).status !== 422) throw error;
    }
  }

  async addLabel(number: number, label: string): Promise<void> {
    await this.api.rest.issues.addLabels({ ...this.base, issue_number: number, labels: [label] });
  }

  async hasLabel(number: number, label: string): Promise<boolean> {
    const { data } = await this.api.rest.issues.get({ ...this.base, issue_number: number });
    return data.labels.some((l) => (typeof l === "string" ? l : l.name) === label);
  }

  /**
   * Report a check-run conclusion on a commit. `action_required` blocks a required
   * check while rendering as an orange "action required" state rather than a red
   * failure; `success` clears it.
   */
  async reportCheck(
    name: string,
    headSha: string,
    conclusion: "success" | "action_required",
    title: string,
    summary: string,
  ): Promise<void> {
    await this.api.rest.checks.create({
      ...this.base,
      name,
      head_sha: headSha,
      status: "completed",
      conclusion,
      output: { title, summary },
    });
  }
}
