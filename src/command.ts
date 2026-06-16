// Parses the `/changelog` command a human types in a PR comment to finalize an
// entry. The grammar is deliberately small:
//
//   /changelog apply                 → add the drafted entries (medium length)
//   /changelog apply short|med|long  → add the drafted entries at that length
//   /changelog short|med|long        → same, with the `apply` keyword left off
//   /changelog                       → bare trigger, same as `/changelog apply`
//   /changelog <area>: <text>        → add custom text under <area>
//   /changelog <text>                → add custom text under the drafted area
//   /changelog skip                  → no changelog entry needed
//
// `apply` is the advertised "take your suggestion as-is" verb; the length
// keyword may also stand alone. Only the first line that starts with the trigger
// is read, so quoting the command in a reply is ignored.

import type { Areas } from "./areas";

export const TRIGGER = "/changelog";

export type Length = "short" | "medium" | "long";
const LENGTH_TOKENS: Record<string, Length> = {
  short: "short",
  medium: "medium",
  med: "medium",
  long: "long",
};

export type Command =
  | { kind: "length"; length: Length }
  | { kind: "text"; area?: string; text: string }
  | { kind: "skip" };

export function parseCommand(body: string, areas: Areas): Command | undefined {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l === TRIGGER || l.startsWith(`${TRIGGER} `));
  if (line === undefined) return undefined;

  let rest = line.slice(TRIGGER.length).trim();
  if (rest === "apply" || rest.startsWith("apply ")) {
    rest = rest.slice("apply".length).trim();
  }

  if (rest.length === 0) return { kind: "length", length: "medium" };

  const lower = rest.toLowerCase();
  if (lower === "skip") return { kind: "skip" };
  const length = LENGTH_TOKENS[lower];
  if (length) return { kind: "length", length };

  const colon = rest.indexOf(":");
  if (colon !== -1) {
    const area = areas.resolve(rest.slice(0, colon));
    if (area) {
      const text = rest.slice(colon + 1).trim();
      return { kind: "text", area: area.id, text };
    }
  }
  return { kind: "text", text: rest };
}
