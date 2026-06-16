import { describe, expect, test } from "bun:test";
import { supportsJsonSchema, temperatureFor, typeLabel } from "./llm";

describe("supportsJsonSchema", () => {
  test("true for verified json_schema families", () => {
    for (const m of ["mimo-v2.5", "mimo-v2.5-pro", "glm-5.1", "kimi-k2.6", "GLM-5"]) {
      expect(supportsJsonSchema(m)).toBe(true);
    }
  });

  test("false for DeepSeek and unknown models (json_object fallback)", () => {
    for (const m of ["deepseek-v4-flash", "deepseek-v4-pro", "qwen3.7-max", "gpt-5.5", ""]) {
      expect(supportsJsonSchema(m)).toBe(false);
    }
  });
});

describe("temperatureFor", () => {
  test("1 for Moonshot code models that reject temperature 0", () => {
    expect(temperatureFor("kimi-k2.7-code")).toBe(1);
    expect(temperatureFor("KIMI-K2.7-CODE")).toBe(1);
  });

  test("0 (deterministic) for everything else", () => {
    for (const m of ["mimo-v2.5", "kimi-k2.6", "glm-5.1", "deepseek-v4-flash", ""]) {
      expect(temperatureFor(m)).toBe(0);
    }
  });
});

describe("typeLabel", () => {
  test("canonicalises known aliases", () => {
    expect(typeLabel("feat")).toBe("Feature");
    expect(typeLabel("BUGFIX")).toBe("Fix");
    expect(typeLabel(" Perf ")).toBe("Performance");
  });

  test("labels internal-tier types", () => {
    expect(typeLabel("refactor")).toBe("Refactor");
    expect(typeLabel("docs")).toBe("Docs");
    expect(typeLabel("tests")).toBe("Test");
    expect(typeLabel("ci")).toBe("CI");
    expect(typeLabel("deps")).toBe("Dependencies");
  });

  test("falls back to Change for unknown types", () => {
    expect(typeLabel("whatever")).toBe("Change");
  });
});
