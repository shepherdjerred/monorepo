/** Pure decision helpers for the legacy import.
 *
 *  Split out so they can be unit-tested without importing `#src/db/index.ts`,
 *  which constructs a Prisma client and libSQL adapter at module scope and
 *  would leave those resources alive across test files. */
/**
 * TypeORM's sqlite driver wrote `datetime` as text with no timezone suffix.
 * Production carries two shapes:
 *
 *   - `2026-08-07 01:44:39.717` — 325 rows written by this bot
 *   - `2023-04-24 03:05:49`     — 37 rows, the `reason: "legacy karma"` import
 *                                 from the predecessor bot, written without
 *                                 milliseconds
 *
 * Both are UTC, confirmed against production rather than assumed: the database
 * file's mtime was `Aug 6 18:44` as rendered inside the container
 * (TZ=America/Los_Angeles, i.e. UTC-7 in August) while the newest row carries
 * `2026-08-07 01:44:39.717` — exactly seven hours ahead.
 */
const LEGACY_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/;

export function parseLegacyDatetime(value: string): Date {
  const match = LEGACY_DATETIME.exec(value);
  if (match === null) {
    throw new Error(
      `Legacy datetime ${JSON.stringify(value)} does not match the expected 'YYYY-MM-DD HH:MM:SS[.SSS]' format`,
    );
  }
  const [, year, month, day, hour, minute, second, millisecond] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      millisecond === undefined ? 0 : Number(millisecond),
    ),
  );
}

export type LegacyImportDecision =
  | { action: "skip"; reason: string }
  | { action: "import"; sourcePath: string };

/**
 * Decide whether startup should import the legacy database.
 *
 * Kept pure so the lifecycle is testable without a database or filesystem.
 *
 * The semantics are deliberately unambiguous:
 *   - `LEGACY_DATABASE_PATH` unset — nothing to migrate (fresh install, or the
 *     cutover already happened and the variable was removed). Skip.
 *   - Target already has karma — the import already ran. Skip. This is what
 *     makes an automatic import safe to leave wired up permanently.
 *   - Path set but the file is absent — a misconfiguration, not a state to
 *     tolerate: importing nothing here would silently start the bot with an
 *     empty leaderboard. Fail.
 */
export function decideLegacyImport(params: {
  legacyPath: string | undefined;
  legacyFileExists: boolean;
  targetKarmaRows: number;
}): LegacyImportDecision {
  const { legacyPath, legacyFileExists, targetKarmaRows } = params;

  if (legacyPath === undefined || legacyPath === "") {
    return { action: "skip", reason: "LEGACY_DATABASE_PATH is not set" };
  }
  if (targetKarmaRows > 0) {
    return {
      action: "skip",
      reason: `target already has ${String(targetKarmaRows)} karma row(s); the import already ran`,
    };
  }
  if (!legacyFileExists) {
    throw new Error(
      `LEGACY_DATABASE_PATH is set to ${legacyPath} but no file exists there. Unset it if there is nothing to migrate; otherwise fix the path — starting with an empty database would look like total karma loss.`,
    );
  }
  return { action: "import", sourcePath: legacyPath };
}
