import { describe, expect, test } from "bun:test";
import { decideLegacyImport, parseLegacyDatetime } from "./import-legacy.ts";

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

describe("decideLegacyImport", () => {
  test("skips when no legacy path is configured", () => {
    expect(
      decideLegacyImport({
        legacyPath: undefined,
        legacyFileExists: false,
        targetKarmaRows: 0,
      }),
    ).toEqual({ action: "skip", reason: "LEGACY_DATABASE_PATH is not set" });
  });

  test("skips an empty string path the same as unset", () => {
    expect(
      decideLegacyImport({
        legacyPath: "",
        legacyFileExists: false,
        targetKarmaRows: 0,
      }).action,
    ).toBe("skip");
  });

  test("imports when a legacy file exists and the target is empty", () => {
    expect(
      decideLegacyImport({
        legacyPath: "/data/glitter.sqlite",
        legacyFileExists: true,
        targetKarmaRows: 0,
      }),
    ).toEqual({ action: "import", sourcePath: "/data/glitter.sqlite" });
  });

  test("skips once the target already has karma", () => {
    // This is what makes an automatic import safe to leave wired up on every
    // boot: the second start must not re-import.
    expect(
      decideLegacyImport({
        legacyPath: "/data/glitter.sqlite",
        legacyFileExists: true,
        targetKarmaRows: 362,
      }),
    ).toEqual({
      action: "skip",
      reason: "target already has 362 karma row(s); the import already ran",
    });
  });

  test("throws when the configured legacy file is missing", () => {
    // Silently starting empty would look exactly like total karma loss, so a
    // configured-but-absent path is treated as a misconfiguration.
    expect(() =>
      decideLegacyImport({
        legacyPath: "/data/typo.sqlite",
        legacyFileExists: false,
        targetKarmaRows: 0,
      }),
    ).toThrow(/no file exists there/);
  });

  test("a populated target wins over a missing file", () => {
    // Post-cutover the operator may delete the legacy file while leaving the
    // variable set. That must not crash-loop the bot.
    expect(
      decideLegacyImport({
        legacyPath: "/data/glitter.sqlite",
        legacyFileExists: false,
        targetKarmaRows: 362,
      }).action,
    ).toBe("skip");
  });
});
