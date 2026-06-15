// The consuming repo's bot config, read from `.github/bot.yml`. Everything
// repo-specific lives here so the bot itself stays generic: the product line fed
// to the drafter, who may finalize an entry, and the changelog areas. Parsing is
// strict (unknown keys fail) so a typo surfaces loudly instead of being ignored.

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Areas, type Area } from "./areas";

type NonEmpty<T> = [T, ...T[]];

const areaSchema = z
  .object({
    id: z.string().min(1),
    heading: z.string().min(1),
    aliases: z.array(z.string()).default([]),
  })
  .strict();

const configSchema = z
  .object({
    product: z.string().min(1).describe("one-line product description fed to the drafter"),
    maintainers: z.array(z.string()).default([]),
    areas: z.array(areaSchema).min(1),
  })
  .strict();

export type Config = {
  product: string;
  /** Logins whose `/changelog` always applies and whose pick wins. */
  maintainers: string[];
  areas: Areas;
};

export function parseConfig(raw: string): Config {
  const data = configSchema.parse(parseYaml(raw));
  return {
    product: data.product,
    maintainers: data.maintainers,
    // zod's .min(1) above proves non-emptiness at runtime; assert it into the type.
    areas: new Areas(data.areas as NonEmpty<Area>),
  };
}

export async function loadConfig(path: string): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`missing changelog config at ${path}; add .github/bot.yml`);
  }
  try {
    return parseConfig(await file.text());
  } catch (error) {
    throw new Error(`parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
