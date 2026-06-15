// Parses the `/changelog` command a human types in a PR comment to finalize an
// entry. The grammar is deliberately small:
//
//   /changelog apply                 → add the medium drafted entry
//   /changelog apply short|long      → add a specific drafted length
//   /changelog <area>: <text>        → add custom text under <area>
//   /changelog <text>                → add custom text under the drafted area
//   /changelog skip                  → no changelog entry needed
//
// The leading `apply` keyword is optional sugar. Only the first line that starts
// with the trigger is read, so quoting the command in a reply is ignored.

import type { Areas } from "./areas";

export const TRIGGER = "/changelog";

export type Length = "short" | "medium" | "long";
const LENGTHS: readonly Length[] = ["short", "medium", "long"];

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
  if (isLength(lower)) return { kind: "length", length: lower };

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

function isLength(value: string): value is Length {
  return (LENGTHS as readonly string[]).includes(value);
}
