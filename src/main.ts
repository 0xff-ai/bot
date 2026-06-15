#!/usr/bin/env bun

import { ChangelogBot } from "./bot";
import { parseArgs, requirePr, runCli } from "./cli";
import { loadConfig } from "./config";
import { GitHub } from "./github";
import { Repo } from "./repo";

const USAGE = "usage: main.ts propose --pr N | apply --pr N | gate --pr N";

await runCli(async () => {
  const { values, positionals } = parseArgs(Bun.argv.slice(2), {
    pr: { type: "string" },
  });
  const [command = ""] = positionals;
  if (command !== "propose" && command !== "apply" && command !== "gate") throw new Error(USAGE);

  const repo = Repo.discover();
  const config = await loadConfig(repo.path(".github/bot.yml"));
  const pr = requirePr(values.pr);
  // Built after config and args validate, so their errors surface before a token check.
  const bot = new ChangelogBot(repo, config, GitHub.fromEnv());

  if (command === "propose") {
    await bot.propose(pr);
    return;
  }
  if (command === "gate") {
    const headSha = process.env.BOT_HEAD_SHA;
    if (!headSha) throw new Error("BOT_HEAD_SHA is not set");
    await bot.gate(pr, headSha);
    return;
  }
  await bot.apply(pr, {
    body: process.env.BOT_COMMENT_BODY ?? "",
    author: process.env.BOT_COMMENT_AUTHOR ?? "",
    association: process.env.BOT_COMMENT_ASSOCIATION ?? "",
  });
});
