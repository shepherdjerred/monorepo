import { describe, expect, test } from "bun:test";
import { parseLegacyDatetime } from "./import-legacy.ts";

describe("parseLegacyDatetime", () => {
  test("parses the millisecond form this bot wrote", () => {
    // Newest production row at the time of the migration.
    expect(parseLegacyDatetime("2026-08-07 01:44:39.717").toISOString()).toBe(
      "2026-08-07T01:44:39.717Z",
    );
  });

  test("parses the millisecond-less form of the predecessor import", () => {
    // Oldest production row; the 37 `reason: "legacy karma"` rows omit millis.
    expect(parseLegacyDatetime("2023-04-24 03:05:49").toISOString()).toBe(
      "2023-04-24T03:05:49.000Z",
    );
  });

  test("treats the value as UTC, not local time", () => {
    // The whole migration hinges on this: TypeORM's sqlite driver wrote UTC
    // with no offset suffix. Reading it as local time would shift every
    // timestamp by the host offset.
    expect(parseLegacyDatetime("2023-01-01 00:00:00.000").getTime()).toBe(
      Date.UTC(2023, 0, 1, 0, 0, 0, 0),
    );
  });

  test.each([
    ["2026-08-07T01:44:39.717Z", "ISO form with T and Z"],
    ["2026-08-07 01:44:39.7", "one-digit milliseconds"],
    ["2026-08-07 01:44", "missing seconds"],
    ["not a date", "free text"],
    ["", "empty string"],
  ])("rejects %s (%s)", (value) => {
    expect(() => parseLegacyDatetime(value)).toThrow(
      /does not match the expected/,
    );
  });
});
