import { describe, expect, test } from "bun:test";
import {
  formatTimecode,
  parseTimecode,
} from "@shepherdjerred/streambot/discord/timecode.ts";

describe("parseTimecode", () => {
  test("plain seconds", () => {
    expect(parseTimecode("0")).toBe(0);
    expect(parseTimecode("90")).toBe(90);
    expect(parseTimecode("  42 ")).toBe(42);
  });

  test("mm:ss", () => {
    expect(parseTimecode("1:30")).toBe(90);
    expect(parseTimecode("0:05")).toBe(5);
    expect(parseTimecode("10:00")).toBe(600);
  });

  test("hh:mm:ss", () => {
    expect(parseTimecode("1:02:03")).toBe(3723);
    expect(parseTimecode("0:00:01")).toBe(1);
  });

  test("rejects malformed input", () => {
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("   ")).toBeNull();
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
    expect(parseTimecode("1:90")).toBeNull(); // seconds field out of range
    expect(parseTimecode("1:60:00")).toBeNull(); // minutes field out of range
    expect(parseTimecode("-5")).toBeNull();
    expect(parseTimecode("1.5")).toBeNull();
  });
});

describe("formatTimecode", () => {
  test("formats under an hour as m:ss", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(5)).toBe("0:05");
    expect(formatTimecode(90)).toBe("1:30");
    expect(formatTimecode(600)).toBe("10:00");
  });

  test("formats an hour or more as h:mm:ss", () => {
    expect(formatTimecode(3723)).toBe("1:02:03");
    expect(formatTimecode(3600)).toBe("1:00:00");
  });

  test("clamps and floors", () => {
    expect(formatTimecode(-5)).toBe("0:00");
    expect(formatTimecode(90.9)).toBe("1:30");
  });

  test("round-trips with parseTimecode", () => {
    for (const s of [0, 5, 90, 600, 3723]) {
      expect(parseTimecode(formatTimecode(s))).toBe(s);
    }
  });
});
