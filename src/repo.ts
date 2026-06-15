import { $, type ShellExpression } from "bun";
import { join } from "node:path";

/** The consuming repo's checkout, where CHANGELOG.md and .github/bot.yml live. */
export class Repo {
  constructor(readonly root: string) {}

  static discover(): Repo {
    return new Repo(process.env.GITHUB_WORKSPACE ?? process.cwd());
  }

  path(...parts: string[]): string {
    return join(this.root, ...parts);
  }

  $(strings: TemplateStringsArray, ...expressions: ShellExpression[]) {
    return $(strings, ...expressions).cwd(this.root);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
