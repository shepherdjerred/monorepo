import { describe, expect, test } from "bun:test";
import { parseNetDate } from "./client.ts";

describe("parseNetDate", () => {
  test("parses .NET date string", () => {
    const result = parseNetDate("/Date(1772348400000)/");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("parses backslash-escaped .NET date string", () => {
    const result = parseNetDate(String.raw`\/Date(1772348400000)\/`);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("handles different timestamps", () => {
    const result = parseNetDate("/Date(1704067200000)/");
    expect(result).toBe("2024-01-01");
  });

  test("throws on invalid date string", () => {
    expect(() => parseNetDate("not a date")).toThrow("Invalid .NET date string");
  });
});
