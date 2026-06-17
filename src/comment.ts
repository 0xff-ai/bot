// The bot's proposal lives in one sticky PR comment, marked with MARKER. It shows
// the drafted entries in the same `type(area): wording` form a maintainer types
// back, plus a hidden base64 data block so `/changelog apply` can recover the
// exact drafted text without re-calling the model (what the human saw is what
// gets added).

import type { Areas } from "./areas";
import { TYPE_IDS, typeLabel, type ChangelogDraft } from "./llm";

export const MARKER = "<!-- 0xff-changelog -->";
const DATA_PREFIX = "<!-- 0xff-changelog-data:";
const DATA_SUFFIX = "-->";

/** Render the proposal comment: the drafted entries plus a hidden data block. */
export function renderProposal(draft: ChangelogDraft, areas: Areas): string {
  // base64 so option text containing "-->" cannot truncate the data block early.
  const data = `${DATA_PREFIX} ${Buffer.from(JSON.stringify(draft), "utf8").toString("base64")} ${DATA_SUFFIX}`;
  if (draft.entries.length === 0) {
    // The drafter never skips, so this only happens if drafting failed. Invite a
    // manual entry rather than silently leaving the PR undocumented.
    return [
      MARKER,
      "",
      "I couldn't draft a changelog entry for this PR. Add one with `/changelog` followed by `type(area): wording` lines, or `/changelog skip` to omit.",
      data,
    ].join("\n");
  }
  const n = draft.entries.length;
  // A readable bulleted list (wraps naturally, unlike a code block). The
  // typeable `type(area): wording` shape lives in the Commands block instead.
  const bullets = draft.entries
    .map((e) => `- **${areas.byId(e.area).heading}** (_${typeLabel(e.type)}_): ${e.medium}`)
    .join("\n");
  const exampleArea = areas.list[0]!.id;
  const commandExamples = [
    "/changelog apply",
    "/changelog skip",
    "/changelog",
    `feat(${exampleArea}): your first entry`,
    `fix(${exampleArea}): your second entry`,
  ].join("\n");
  const typeList = TYPE_IDS.map((t) => `\`${t}\``).join(", ");
  const areaList = areas.list.map((a) => `\`${a.id}\``).join(", ");
  return [
    MARKER,
    "",
    `**Proposed changelog** (${n} entr${n === 1 ? "y" : "ies"}):`,
    "",
    bullets,
    "",
    "`/changelog apply` to add these, or `/changelog` with your own `type(area): wording` lines. `/changelog skip` to omit.",
    "",
    "<details><summary>Commands</summary>",
    "",
    "```",
    commandExamples,
    "```",
    "",
    `Types: ${typeList}.`,
    `Areas: ${areaList}.`,
    "",
    "</details>",
    data,
  ].join("\n");
}

/**
 * Render the applied comment: once the entry is committed, the sticky comment is
 * edited down to just this confirmation, dropping the proposals and data block.
 */
export function renderApplied(message: string): string {
  return [MARKER, "", message].join("\n");
}

/** Recover the drafted options from a proposal comment body, or undefined. */
export function parseProposalData(body: string): ChangelogDraft | undefined {
  if (!body.includes(MARKER)) return undefined;
  const start = body.indexOf(DATA_PREFIX);
  if (start === -1) return undefined;
  const end = body.indexOf(DATA_SUFFIX, start + DATA_PREFIX.length);
  if (end === -1) return undefined;
  try {
    const json = Buffer.from(body.slice(start + DATA_PREFIX.length, end).trim(), "base64").toString("utf8");
    return JSON.parse(json) as ChangelogDraft;
  } catch {
    return undefined;
  }
}
