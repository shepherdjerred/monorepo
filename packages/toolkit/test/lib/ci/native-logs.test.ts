import { describe, expect, test } from "vitest";
import { decodeLogs } from "#lib/ci/native-logs.ts";

describe("decodeLogs", () => {
  test("returns empty array for null or undefined log payload", () => {
    expect(decodeLogs(null)).toEqual([]);
    expect(decodeLogs(undefined)).toEqual([]);
  });

  test("returns empty array for empty logs array", () => {
    expect(decodeLogs([])).toEqual([]);
  });

  test("decodes and sorts base64 log entries", () => {
    const raw = [
      {
        line: 2,
        type: 1,
        data: Buffer.from("second line\n").toString("base64"),
      },
      {
        line: 1,
        type: 1,
        data: Buffer.from("first line\n").toString("base64"),
      },
      {
        line: 3,
        type: 1,
        data: null,
      },
    ];
    expect(decodeLogs(raw)).toEqual(["first line", "", "second line", ""]);
  });
});
