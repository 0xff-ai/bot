import { describe, expect, test } from "bun:test";
import { parseCommand } from "./command";
import { testAreas } from "./fixtures";

const parse = (body: string) => parseCommand(body, testAreas);

describe("parseCommand", () => {
  test("bare apply selects the medium length", () => {
    expect(parse("/changelog apply")).toEqual({ kind: "length", length: "medium" });
  });

  test("trigger with nothing else selects the medium length", () => {
    expect(parse("/changelog")).toEqual({ kind: "length", length: "medium" });
  });

  test("apply with a length selects that length", () => {
    expect(parse("/changelog apply short")).toEqual({ kind: "length", length: "short" });
    expect(parse("/changelog apply long")).toEqual({ kind: "length", length: "long" });
  });

  test("a length without the apply keyword still works", () => {
    expect(parse("/changelog long")).toEqual({ kind: "length", length: "long" });
  });

  test("skip is recognized", () => {
    expect(parse("/changelog skip")).toEqual({ kind: "skip" });
  });

  test("area-prefixed custom text resolves the area by alias", () => {
    expect(parse("/changelog npm: dev tag now published")).toEqual({
      kind: "text",
      area: "packaging",
      text: "dev tag now published",
    });
  });

  test("apply plus area-prefixed text works", () => {
    expect(parse("/changelog apply runtime: faster mounts")).toEqual({
      kind: "text",
      area: "runtime",
      text: "faster mounts",
    });
  });

  test("custom text with no resolvable area keeps the colon as text", () => {
    expect(parse("/changelog note: see above")).toEqual({ kind: "text", text: "note: see above" });
  });

  test("free text with no colon has no area", () => {
    expect(parse("/changelog the daemon restarts cleanly now")).toEqual({
      kind: "text",
      text: "the daemon restarts cleanly now",
    });
  });

  test("reads the command line even when surrounded by other prose", () => {
    expect(parse("thanks!\n\n/changelog apply short\n\n-- me")).toEqual({
      kind: "length",
      length: "short",
    });
  });

  test("a comment without the trigger is not a command", () => {
    expect(parse("looks good to me")).toBeUndefined();
  });

  test("the trigger must start the line, not appear mid-sentence", () => {
    expect(parse("run /changelog apply to add it")).toBeUndefined();
  });
});
