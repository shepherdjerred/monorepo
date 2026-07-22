import { describe, expect, test } from "bun:test";

import { asRecord, toStringRecord } from "./json.ts";

describe("dependency-free JSON narrowing", () => {
  test("accepts plain records and keeps unknown values", () => {
    expect(asRecord({ text: "value", count: 2 })).toEqual({
      text: "value",
      count: 2,
    });
  });

  test("rejects non-record values", () => {
    expect(asRecord(null)).toBeNull();
    expect(asRecord(["value"])).toBeNull();
    expect(asRecord("value")).toBeNull();
  });

  test("keeps only string values", () => {
    expect(toStringRecord({ keep: "value", drop: 2 })).toEqual({
      keep: "value",
    });
  });

  test("rejects accessor properties without invoking them", () => {
    const input = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => {
        throw new Error("getter must not execute");
      },
    });
    expect(asRecord(input)).toBeNull();
  });
});
