// The bot's proposal lives in one sticky PR comment, marked with MARKER. It shows
// the three length options in human-readable form plus a hidden base64 data block,
// so the apply stage can recover the exact drafted text for `/changelog apply
// <length>` without re-calling the model (what the human saw is what gets added).

import type { Areas } from "./areas";
import type { ChangelogDraft } from "./llm";

export const MARKER = "<!-- 0xff-changelog -->";
const DATA_PREFIX = "<!-- 0xff-changelog-data:";
const DATA_SUFFIX = "-->";

/** Render the proposal comment: human-readable options plus a hidden data block. */
export function renderProposal(draft: ChangelogDraft, areas: Areas): string {
  // base64 so option text containing "-->" cannot truncate the data block early.
  const data = `${DATA_PREFIX} ${Buffer.from(JSON.stringify(draft), "utf8").toString("base64")} ${DATA_SUFFIX}`;
  if (draft.skip) {
    return [
      MARKER,
      "",
      "_No changelog entry: this PR looks like it has no user-facing change, so I added the `no-changelog` label. If that's wrong, remove the label and comment `/changelog <area>: your text`._",
      data,
    ].join("\n");
  }
  return [
    MARKER,
    "",
    `**Proposed changelog entry** under _${areas.byId(draft.area).heading}_. Reply to add it to this PR:`,
    "",
    "- `/changelog apply` — add the medium entry below",
    "- `/changelog apply short` or `/changelog apply long` — pick another length",
    "- `/changelog <area>: your wording` — custom text",
    "- `/changelog skip` — no changelog needed",
    "",
    `- short: ${draft.short}`,
    `- medium: ${draft.medium}`,
    `- long: ${draft.long}`,
    "",
    "_Or just edit `CHANGELOG.md` yourself; this never overwrites hand-edits._",
    data,
  ].join("\n");
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
