import { describe, expect, test } from "bun:test";
import { randomTip, TIPS } from "@shepherdjerred/streambot/discord/tips.ts";

describe("tips", () => {
  test("has a non-trivial pool of tips", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(10);
    for (const tip of TIPS) {
      expect(tip.length).toBeGreaterThan(0);
    }
  });

  test("randomTip always returns a tip from the pool", () => {
    for (let i = 0; i < 50; i++) {
      expect(TIPS).toContain(randomTip());
    }
  });
});
