import { describe, expect, test } from "vitest";

import { snapshotStalenessWarning } from "./check-1password-items.ts";

const NOW = new Date("2026-08-16T00:00:00Z");

describe("snapshotStalenessWarning", () => {
  test("stays quiet for a recently refreshed snapshot", () => {
    // The snapshot legitimately ages between vault changes, so a fresh-enough
    // one must not nag on PRs that touched nothing related.
    expect(
      snapshotStalenessWarning("2026-08-11T02:11:02.518Z", NOW),
    ).toBeNull();
  });

  test("reports the age once the snapshot is too old to trust", () => {
    // A clean result against a stale snapshot means "nothing contradicts an
    // old record", not "the vault agrees" — say so rather than imply coverage.
    const warning = snapshotStalenessWarning("2026-01-01T00:00:00Z", NOW);
    expect(warning).toContain("227 days old");
    expect(warning).toContain("snapshot-1password-vault.ts");
  });

  test("treats an unparseable timestamp as a refresh prompt", () => {
    expect(snapshotStalenessWarning("not-a-date", NOW)).toContain(
      "unparseable generatedAt",
    );
  });

  test("honours the boundary exactly", () => {
    const exactly = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000);
    expect(snapshotStalenessWarning(exactly.toISOString(), NOW)).toBeNull();
    const oneDayPast = new Date(NOW.getTime() - 46 * 24 * 60 * 60 * 1000);
    expect(snapshotStalenessWarning(oneDayPast.toISOString(), NOW)).toContain(
      "46 days old",
    );
  });
});
