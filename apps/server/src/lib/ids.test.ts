import { describe, expect, it } from "vitest";
import { buildGameTaskId } from "./ids";

describe("buildGameTaskId", () => {
  it("is deterministic for the same game and index", () => {
    const first = buildGameTaskId("11111111-1111-1111-1111-111111111111", 0);
    const second = buildGameTaskId("11111111-1111-1111-1111-111111111111", 0);
    expect(first).toBe(second);
  });

  it("varies across games and indices", () => {
    const base = buildGameTaskId("11111111-1111-1111-1111-111111111111", 0);
    const otherGame = buildGameTaskId("22222222-2222-2222-2222-222222222222", 0);
    const otherIndex = buildGameTaskId("11111111-1111-1111-1111-111111111111", 1);
    expect(base).not.toBe(otherGame);
    expect(base).not.toBe(otherIndex);
  });
});
