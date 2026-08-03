import { describe, expect, test } from "bun:test";
import { GoalActivityLog } from "./goal-activity.ts";

function call(path: string, at: number, status = 200) {
  return { method: "POST", path, status, at };
}

describe("GoalActivityLog", () => {
  test("summarizeSince returns undefined with no calls in the window", () => {
    const log = new GoalActivityLog();
    expect(log.summarizeSince(0)).toBeUndefined();
    log.record(call("/move", 10));
    expect(log.summarizeSince(11)).toBeUndefined();
  });

  test("summarizeSince aggregates counts by path within the window", () => {
    const log = new GoalActivityLog();
    log.record(call("/move", 1));
    log.record(call("/move", 2));
    log.record(call("/observe", 3));
    log.record(call("/move", 0)); // outside the window
    expect(log.summarizeSince(1)).toBe("3 actions (2 /move, 1 /observe)");
  });

  test("summarizeSince counts 4xx/5xx responses as errors", () => {
    const log = new GoalActivityLog();
    log.record(call("/battle/run", 1, 400));
    log.record(call("/press", 2));
    expect(log.summarizeSince(0)).toBe(
      "2 actions (1 /battle/run, 1 /press, 1 err)",
    );
  });

  test("summarizeSince truncates to the top four paths", () => {
    const log = new GoalActivityLog();
    for (const [index, path] of ["/a", "/b", "/c", "/d", "/e"].entries()) {
      for (let i = 0; i <= index; i++) {
        log.record(call(path, 1));
      }
    }
    expect(log.summarizeSince(0)).toBe(
      "15 actions (5 /e, 4 /d, 3 /c, 2 /b, …)",
    );
  });

  test("ring buffer evicts oldest entries beyond capacity", () => {
    const log = new GoalActivityLog();
    for (let i = 0; i < 150; i++) {
      log.record(call("/move", i));
    }
    // Only the newest 100 remain: 50..149.
    expect(log.summarizeSince(0)).toBe("100 actions (100 /move)");
    expect(log.summarizeSince(140)).toBe("10 actions (10 /move)");
  });

  test("tracks the latest non-empty agent message", () => {
    const log = new GoalActivityLog();
    expect(log.lastAgentMessage()).toBeUndefined();
    log.noteAgentMessage("heading to Oldale");
    log.noteAgentMessage("   ");
    expect(log.lastAgentMessage()).toBe("heading to Oldale");
    log.noteAgentMessage("buying balls");
    expect(log.lastAgentMessage()).toBe("buying balls");
  });
});
