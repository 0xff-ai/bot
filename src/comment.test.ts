import { describe, expect, test } from "bun:test";
import { parseProposalData, renderProposal } from "./comment";
import { testAreas } from "./fixtures";
import type { ChangelogDraft } from "./llm";

const draft: ChangelogDraft = {
  skip: false,
  area: "providers",
  short: "arXiv stops crashing",
  medium: "The arXiv provider no longer crashes on malformed entries.",
  long: "The arXiv provider no longer crashes when an entry is missing its abstract; the path renders an empty file instead of erroring.",
};

describe("proposal comment data block", () => {
  test("round-trips a draft through render then parse", () => {
    expect(parseProposalData(renderProposal(draft, testAreas))).toEqual(draft);
  });

  test("round-trips a skip draft", () => {
    const skip: ChangelogDraft = { ...draft, skip: true, short: "", medium: "", long: "" };
    expect(parseProposalData(renderProposal(skip, testAreas))).toEqual(skip);
  });

  test("survives text containing the comment terminator and unicode", () => {
    // "-->" in the body must not truncate the base64 data block; unicode must survive.
    const tricky: ChangelogDraft = { ...draft, medium: "routes /a --> /b now resolve, cafe included" };
    expect(parseProposalData(renderProposal(tricky, testAreas))).toEqual(tricky);
  });

  test("leads with the medium entry and the area, and includes every length and the apply command", () => {
    const body = renderProposal(draft, testAreas);
    expect(body).toContain("/changelog apply");
    expect(body).toContain(testAreas.byId(draft.area).heading);
    expect(body).toContain(`> ${draft.medium}`); // medium shown prominently as a blockquote
    expect(body).toContain(draft.short);
    expect(body).toContain(draft.long);
  });

  test("returns undefined for a comment without the marker", () => {
    expect(parseProposalData("just a normal review comment")).toBeUndefined();
  });
});
