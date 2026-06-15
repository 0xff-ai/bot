import { parseArgs as parseNodeArgs, type ParseArgsConfig } from "node:util";
import { errorMessage } from "./repo";

type Options = NonNullable<ParseArgsConfig["options"]>;

export function parseArgs<O extends Options>(args: string[], options: O) {
  return parseNodeArgs({ args, allowPositionals: true, options });
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}

export function requirePr(value: unknown): number {
  const pr = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error("--pr must be a positive PR number");
  }
  return pr;
}
