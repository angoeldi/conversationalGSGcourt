import { describe, expect, it } from "vitest";
import { formatPortraitPrompt } from "../lib/portraitPrompt";

describe("formatPortraitPrompt", () => {
  it("adds HF guidance for general image models", () => {
    const base = "Portrait of Queen Ada, ruler of Ada, 1492.";
    const result = formatPortraitPrompt(base, "hf");
    expect(result).toContain(base);
    expect(result).toContain("Single subject portrait");
    expect(result).toContain("No text");
  });

  it("leaves OpenAI prompts unchanged", () => {
    const base = "Portrait of Queen Ada.";
    expect(formatPortraitPrompt(base, "openai")).toBe(base);
  });
});
