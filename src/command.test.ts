import { describe, expect, test } from "bun:test";
import { parseCommand } from "./command";
import { testAreas } from "./fixtures";

const parse = (body: string) => parseCommand(body, testAreas);

describe("parseCommand", () => {
  test("bare apply accepts the draft", () => {
    expect(parse("/changelog apply")).toEqual({ kind: "apply" });
  });

  test("trigger with nothing else accepts the draft", () => {
    expect(parse("/changelog")).toEqual({ kind: "apply" });
  });

  test("skip is recognized", () => {
    expect(parse("/changelog skip")).toEqual({ kind: "skip" });
  });

  test("custom entry lines after the trigger parse as entries", () => {
    expect(parse("/changelog\nfeat(cli): self-explanatory auth\nfix(runtime): faster mounts")).toEqual({
      kind: "entries",
      entries: [
        { type: "feat", area: "cli", text: "self-explanatory auth" },
        { type: "fix", area: "runtime", text: "faster mounts" },
      ],
    });
  });

  test("a single entry on the trigger line itself parses", () => {
    expect(parse("/changelog feat(cli): self-explanatory auth")).toEqual({
      kind: "entries",
      entries: [{ type: "feat", area: "cli", text: "self-explanatory auth" }],
    });
  });

  test("the area token resolves by alias", () => {
    expect(parse("/changelog feat(npm): dev tag now published")).toEqual({
      kind: "entries",
      entries: [{ type: "feat", area: "packaging", text: "dev tag now published" }],
    });
  });

  test("an unknown area is a reported error, not a silent drop", () => {
    const cmd = parse("/changelog feat(nope): something");
    expect(cmd?.kind).toBe("error");
    if (cmd?.kind === "error") expect(cmd.message).toContain("Unknown area");
  });

  test("a line that is not type(area): wording is a reported error", () => {
    const cmd = parse("/changelog\njust some free text");
    expect(cmd?.kind).toBe("error");
    if (cmd?.kind === "error") expect(cmd.message).toContain("Couldn't parse");
  });

  test("a blank line ends the entry block, so a trailing signature is ignored", () => {
    expect(parse("/changelog\nfeat(cli): a thing\n\n-- me")).toEqual({
      kind: "entries",
      entries: [{ type: "feat", area: "cli", text: "a thing" }],
    });
  });

  test("reads the command even when surrounded by other prose", () => {
    expect(parse("thanks!\n\n/changelog apply\n\n-- me")).toEqual({ kind: "apply" });
  });

  test("a comment without the trigger is not a command", () => {
    expect(parse("looks good to me")).toBeUndefined();
  });

  test("the trigger must start the line, not appear mid-sentence", () => {
    expect(parse("run /changelog apply to add it")).toBeUndefined();
  });
});
