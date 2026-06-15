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
  test("loads product, maintainers, and areas", () => {
    const config = parseConfig(VALID);
    expect(config.product).toBe("omnifs, a projected filesystem");
    expect(config.maintainers).toEqual(["raulk"]);
    expect(config.areas.ids).toEqual(["providers", "cli"]);
    expect(config.areas.byId("providers").heading).toBe("Providers & projected paths");
    expect(config.areas.fallback.id).toBe("cli");
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
