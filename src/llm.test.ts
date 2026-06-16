import { describe, expect, test } from "bun:test";
import { supportsJsonSchema, typeLabel } from "./llm";

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

describe("typeLabel", () => {
  test("canonicalises known aliases", () => {
    expect(typeLabel("feat")).toBe("Feature");
    expect(typeLabel("BUGFIX")).toBe("Fix");
    expect(typeLabel(" Perf ")).toBe("Performance");
  });

  test("falls back to Change for unknown types", () => {
    expect(typeLabel("whatever")).toBe("Change");
  });
});
