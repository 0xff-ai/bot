// Parses the `/changelog` command a human types in a PR comment to finalize an
// entry. The grammar is deliberately small:
//
//   /changelog apply              → add the drafted entries as proposed
//   /changelog                    → bare trigger, same as `/changelog apply`
//   /changelog skip               → no changelog entry needed
//   /changelog                    → add your own entries: one `type(area): text`
//   feat(cli): ...                  line per entry, on the lines that follow the
//   fix(runtime): ...               trigger (or on the trigger line itself)
//
// `apply` is the advertised "take your suggestion as-is" verb. Custom entries
// reuse the conventional-commit shape the proposal is rendered in, so a
// maintainer can copy the proposed lines, edit them, and submit them back. Only
// the block starting at the first line that begins with the trigger is read, so
// quoting the command in a reply is ignored.

import type { Areas } from "./areas";

export const TRIGGER = "/changelog";

/** One custom entry parsed from a `type(area): wording` line. */
export type CommandEntry = { type: string; area: string; text: string };

export type Command =
  | { kind: "apply" }
  | { kind: "entries"; entries: CommandEntry[] }
  | { kind: "skip" }
  | { kind: "error"; message: string };

// `type(area): wording`. Type and area are tokens; wording is the rest.
const ENTRY_RE = /^([A-Za-z][\w-]*)\(([^)]+)\)\s*:\s*(.+)$/;

export function parseCommand(body: string, areas: Areas): Command | undefined {
  const lines = body.split(/\r?\n/);
  const idx = lines.findIndex((l) => {
    const t = l.trim();
    return t === TRIGGER || t.startsWith(`${TRIGGER} `);
  });
  if (idx === -1) return undefined;

  const rest = lines[idx]!.trim().slice(TRIGGER.length).trim();
  const lower = rest.toLowerCase();
  if (lower === "skip") return { kind: "skip" };
  if (lower === "apply") return { kind: "apply" };

  // Candidate entry lines: the remainder of the trigger line (if any) plus the
  // following non-empty lines, stopping at the first blank line so a trailing
  // signature or prose is not slurped in.
  const candidates: string[] = [];
  let i = idx + 1;
  if (rest.length > 0) {
    candidates.push(rest);
  } else {
    while (i < lines.length && lines[i]!.trim().length === 0) i++;
  }
  for (; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t.length === 0) break;
    candidates.push(t);
  }

  if (candidates.length === 0) return { kind: "apply" };

  const example = `feat(${areas.list[0]!.id}): your wording`;
  const entries: CommandEntry[] = [];
  for (const line of candidates) {
    const m = ENTRY_RE.exec(line);
    if (!m) {
      return {
        kind: "error",
        message: `Couldn't parse \`${line}\`. Use one \`type(area): wording\` per line, e.g. \`${example}\`.`,
      };
    }
    const [, type, areaToken, text] = m;
    const area = areas.resolve(areaToken!.trim());
    if (!area) {
      const valid = areas.list.map((a) => `\`${a.id}\``).join(", ");
      return { kind: "error", message: `Unknown area \`${areaToken!.trim()}\`. Valid areas: ${valid}.` };
    }
    entries.push({ type: type!.trim(), area: area.id, text: text!.trim() });
  }
  return { kind: "entries", entries };
}
