import { describe, expect, test } from "bun:test";
import { stampEntry } from "./stamp";

describe("stampEntry", () => {
  test("stamps the PR number with no thanks for a maintainer", () => {
    expect(stampEntry("**Fix:** the thing", 12, "raulk", ["raulk"])).toBe("**Fix:** the thing (#12)");
  });

  test("thanks a contributor outside the maintainers set", () => {
    expect(stampEntry("**Feature:** the thing", 12, "alice", ["raulk"])).toBe(
      "**Feature:** the thing (#12, thanks @alice)",
    );
  });

  test("omits thanks when the author is unknown", () => {
    expect(stampEntry("**Fix:** x", 7, "", ["raulk"])).toBe("**Fix:** x (#7)");
  });
});
