import { describe, expect, test } from "bun:test";
import { parseProposalData, renderProposal } from "./comment";
import { testAreas } from "./fixtures";
import { typeLabel, type ChangelogDraft } from "./llm";

const draft: ChangelogDraft = {
  entries: [
    {
      area: "providers",
      type: "fix",
      short: "arXiv stops crashing",
      medium: "The arXiv provider no longer crashes on malformed entries.",
      long: "The arXiv provider no longer crashes when an entry is missing its abstract; the path renders an empty file instead of erroring.",
    },
    {
      area: "cli",
      type: "feature",
      short: "new status command",
      medium: "A new `omnifs status` command reports the daemon and mount state.",
      long: "A new `omnifs status` command reports the daemon and mount state in one place, so you no longer have to read the logs.",
    },
  ],
};

describe("proposal comment data block", () => {
  test("round-trips a multi-entry draft through render then parse", () => {
    expect(parseProposalData(renderProposal(draft, testAreas))).toEqual(draft);
  });

  test("renders an empty-entries draft as a manual-entry invite that still round-trips", () => {
    const empty: ChangelogDraft = { entries: [] };
    const body = renderProposal(empty, testAreas);
    expect(body).toContain("couldn't draft");
    expect(parseProposalData(body)).toEqual(empty);
  });

  test("survives text containing the comment terminator and unicode", () => {
    const tricky: ChangelogDraft = {
      entries: [{ ...draft.entries[0]!, medium: "routes /a --> /b now resolve, cafe included" }],
    };
    expect(parseProposalData(renderProposal(tricky, testAreas))).toEqual(tricky);
  });

  test("lists each entry with area, type, and medium, plus command help and the areas list", () => {
    const body = renderProposal(draft, testAreas);
    expect(body).toContain("(2 entries)");
    expect(body).toContain("/changelog");
    // The low-effort "take your suggestion" path must be visible in the comment.
    expect(body).toContain("/changelog apply");
    for (const e of draft.entries) {
      expect(body).toContain(testAreas.byId(e.area).heading);
      expect(body).toContain(typeLabel(e.type));
      expect(body).toContain(e.medium);
      expect(body).toContain(e.short);
      expect(body).toContain(e.long);
    }
    expect(body).toContain("<summary>Areas</summary>");
  });

  test("returns undefined for a comment without the marker", () => {
    expect(parseProposalData("just a normal review comment")).toBeUndefined();
  });
});

describe("typeLabel", () => {
  test("maps ids and aliases to canonical labels", () => {
    expect(typeLabel("feature")).toBe("Feature");
    expect(typeLabel("feat")).toBe("Feature");
    expect(typeLabel("bugfix")).toBe("Fix");
    expect(typeLabel("PERF")).toBe("Performance");
  });

  test("falls back to Change for an unknown type", () => {
    expect(typeLabel("whatever")).toBe("Change");
  });
});
