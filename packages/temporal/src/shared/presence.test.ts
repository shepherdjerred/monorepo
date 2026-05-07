import { describe, expect, it } from "bun:test";
import { PRESENCE_COOLDOWN_SECONDS, cooldownBucket } from "./presence.ts";

describe("cooldownBucket", () => {
  const WINDOW_MS = PRESENCE_COOLDOWN_SECONDS * 1000;

  it("returns the same bucket for two timestamps inside one tumbling window", () => {
    // Aligned to a bucket boundary so the whole window lives in bucket 5.
    const start = 5 * WINDOW_MS;
    const end = start + WINDOW_MS - 1;
    expect(cooldownBucket(start)).toBe(cooldownBucket(end));
  });

  it("rolls to the next bucket at the window boundary", () => {
    const boundary = 5 * WINDOW_MS;
    expect(cooldownBucket(boundary - 1)).not.toBe(cooldownBucket(boundary));
  });

  it("produces a stable string representation", () => {
    expect(cooldownBucket(0)).toBe("0");
    expect(cooldownBucket(WINDOW_MS)).toBe("1");
    expect(cooldownBucket(2 * WINDOW_MS + 1)).toBe("2");
  });
});
