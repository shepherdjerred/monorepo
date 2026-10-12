import { describe, expect, test } from "vitest";
import { InputLog } from "./input-log.ts";

describe("InputLog", () => {
  test("clears history and notifies connected viewers", () => {
    const log = new InputLog(3);
    log.record({ user: "a", source: "web", command: "a" });
    const sizes: number[] = [];
    log.subscribe((entries) => {
      sizes.push(entries.length);
    });
    log.clear();
    expect(log.recent()).toEqual([]);
    expect(sizes).toEqual([0]);
    log.record({ user: "b", source: "discord", command: "b" });
    expect(log.recent()).toHaveLength(1);
    expect(sizes).toEqual([0, 1]);
  });
  test("keeps only the most recent entries, oldest first", () => {
    const log = new InputLog(2);
    const at = new Date("2026-10-12T12:00:00.000Z");
    log.record({ user: "a", source: "discord", command: "up" }, at);
    log.record({ user: "b", source: "web", command: "a" }, at);
    log.record({ user: "c", source: "web", command: "b" }, at);
    expect(log.recent()).toEqual([
      { id: "2", at: at.toISOString(), user: "b", source: "web", command: "a" },
      { id: "3", at: at.toISOString(), user: "c", source: "web", command: "b" },
    ]);
  });

  test("tells subscribers about every new entry until they unsubscribe", () => {
    const log = new InputLog(5);
    const seen: number[] = [];
    const unsubscribe = log.subscribe((entries) => {
      seen.push(entries.length);
    });
    log.record({ user: "a", source: "discord", command: "up" });
    unsubscribe();
    log.record({ user: "a", source: "discord", command: "up" });
    expect(seen).toEqual([1]);
  });
});
