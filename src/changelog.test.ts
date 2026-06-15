import { describe, expect, test } from "bun:test";
import { appendBulletsToUnreleased, parseChangelog, withUnreleased, type AreaBullet } from "./changelog";
import { testAreas } from "./fixtures";

const append = (body: string, bullets: AreaBullet[]) =>
  appendBulletsToUnreleased(body, bullets, testAreas);

const PREAMBLE = `# Changelog

All notable changes to this project will be documented in this file.
`;

function changelog(body: string): string {
  return `${PREAMBLE}\n${body}`;
}

describe("parseChangelog", () => {
  test("requires [Unreleased]", () => {
    expect(() => parseChangelog(changelog("## [1.0.0] - 2025-01-01\n\n### Added\n- foo\n")))
      .toThrow(/must contain a ## \[Unreleased\] section/);
  });

  test("rejects duplicate [Unreleased]", () => {
    expect(() => parseChangelog(changelog("## [Unreleased]\n\n## [Unreleased]\n")))
      .toThrow(/only one ## \[Unreleased\]/);
  });

  test("captures preamble, unreleased body, and prior sections", () => {
    const log = parseChangelog(
      changelog("## [Unreleased]\n\n### Added\n- new thing\n\n## [1.0.0] - 2025-01-01\n\n### Fixed\n- prior bug\n"),
    );
    expect(log.unreleasedBody).toContain("- new thing");
    expect(log.sections[0]?.heading).toBe("## [1.0.0] - 2025-01-01");
    expect(log.sections[0]?.body).toContain("- prior bug");
  });
});

describe("appendBulletsToUnreleased", () => {
  test("groups a fresh set in canonical area order", () => {
    const body = append("", [
      { area: "packaging", text: "npm dev tag" },
      { area: "providers", text: "new provider path" },
    ]);
    expect(body).toBe(
      "### Providers & projected paths\n- new provider path\n\n### Packaging & release\n- npm dev tag\n",
    );
  });

  test("appends to an existing area subsection without rewriting it", () => {
    const start = "### Providers & projected paths\n- existing bullet\n";
    const merged = append(start, [{ area: "providers", text: "added bullet" }]);
    expect(merged).toBe("### Providers & projected paths\n- existing bullet\n- added bullet\n");
  });

  test("inserts a new area subsection at its canonical position", () => {
    const start = "### Packaging & release\n- pkg note\n";
    const merged = append(start, [{ area: "providers", text: "prov note" }]);
    expect(merged).toBe(
      "### Providers & projected paths\n- prov note\n\n### Packaging & release\n- pkg note\n",
    );
  });

  test("is idempotent on exact-duplicate bullets (re-applying the same entry is a no-op)", () => {
    const start = "### CLI & workflow\n- token refresh fixed\n";
    const merged = append(start, [{ area: "cli", text: "token refresh fixed" }]);
    expect(merged).toBe(start);
  });

  test("preserves a human-edited bullet verbatim while adding a new one", () => {
    const start = "### Runtime & mounts\n- Hand-reworded line a maintainer typed.\n";
    const merged = append(start, [{ area: "runtime", text: "auto bullet" }]);
    expect(merged).toContain("- Hand-reworded line a maintainer typed.");
    expect(merged).toContain("- auto bullet");
  });

  test("re-rendered changelog round-trips through parseChangelog", () => {
    const log = parseChangelog(changelog("## [Unreleased]\n"));
    const body = append(log.unreleasedBody, [{ area: "cli", text: "new flag" }]);
    const next = withUnreleased(log, body);
    const reparsed = parseChangelog(next.raw);
    expect(reparsed.unreleasedBody).toContain("### CLI & workflow");
    expect(reparsed.unreleasedBody).toContain("- new flag");
  });
});
