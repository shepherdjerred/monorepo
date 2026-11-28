import { describe, expect, test } from "vitest";
import { selectLiveFrames, type BudgetFrame } from "./budget.ts";

const frames: BudgetFrame[] = Array.from({ length: 9 }, (_, index) => ({
  id: `f${String(index)}`,
  kind: "html",
}));

describe("selectLiveFrames", () => {
  test("renders the first six frames in board order", () => {
    expect([...selectLiveFrames(frames, [])]).toEqual([
      "f0",
      "f1",
      "f2",
      "f3",
      "f4",
      "f5",
    ]);
  });

  test("a frame the reviewer loaded takes a slot from the last", () => {
    const live = selectLiveFrames(frames, ["f8"]);
    expect(live.size).toBe(6);
    expect(live.has("f8")).toBe(true);
    expect(live.has("f5")).toBe(false);
  });

  test("the most recently loaded frames win when more than six are asked for", () => {
    const loaded = ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"];
    const live = selectLiveFrames(frames, loaded);
    expect(live.has("f7")).toBe(true);
    expect(live.has("f0")).toBe(false);
    expect(live.size).toBe(6);
  });

  test("a file never uses the budget", () => {
    const mixed: BudgetFrame[] = [{ id: "doc", kind: "file" }, ...frames];
    const live = selectLiveFrames(mixed, ["doc"]);
    expect(live.has("doc")).toBe(false);
    expect(live.size).toBe(6);
  });

  test("a smaller board renders everything", () => {
    expect(selectLiveFrames(frames.slice(0, 2), []).size).toBe(2);
  });
});
