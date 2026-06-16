import { describe, expect, test } from "bun:test";
import { parseConfig } from "./config";

const VALID = `
product: omnifs, a projected filesystem
maintainers: [raulk]
areas:
  - id: providers
    heading: Providers & projected paths
    aliases: [provider, paths]
  - id: cli
    heading: CLI & workflow
`;

describe("parseConfig", () => {
  test("loads product, maintainers, and areas, appending the internal tier last", () => {
    const config = parseConfig(VALID);
    expect(config.product).toBe("omnifs, a projected filesystem");
    expect(config.maintainers).toEqual(["raulk"]);
    // The bot appends its own `internal` area after the consumer's, so it sorts
    // last and catches non-user-facing entries.
    expect(config.areas.ids).toEqual(["providers", "cli", "internal"]);
    expect(config.areas.byId("providers").heading).toBe("Providers & projected paths");
    expect(config.areas.byId("internal").heading).toBe("Internal & maintenance");
    expect(config.areas.fallback.id).toBe("internal");
  });

  test("rejects a consumer area that collides with the reserved internal id", () => {
    expect(() => parseConfig("product: x\nareas:\n  - id: internal\n    heading: Mine\n")).toThrow(/reserved area id/);
  });

  test("areas default to an empty alias list", () => {
    const config = parseConfig("product: x\nareas:\n  - id: a\n    heading: A\n");
    expect(config.areas.byId("a").aliases).toEqual([]);
  });

  test("rejects an unknown top-level key (typos fail loudly)", () => {
    expect(() => parseConfig("product: x\naref: []\nareas:\n  - id: a\n    heading: A\n")).toThrow();
  });

  test("rejects an empty areas list", () => {
    expect(() => parseConfig("product: x\nareas: []\n")).toThrow();
  });

  test("rejects a missing product line", () => {
    expect(() => parseConfig("areas:\n  - id: a\n    heading: A\n")).toThrow();
  });
});
