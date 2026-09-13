import { describe, expect, test } from "vitest";
import {
  MAX_DISCORD_ALERT_AGE_MS,
  isPostmatchReportStale,
  postmatchReportFreshnessDeadline,
} from "#src/league/tasks/postmatch/match-report-delivery.ts";

const GAME_CREATION = Date.parse("2026-09-12T09:00:00.000Z");

describe("post-match report freshness", () => {
  test("the delivery gate and the intent's deadline are the same instant", () => {
    const deadline = postmatchReportFreshnessDeadline(GAME_CREATION);

    // Both comparisons are STRICTLY after, so the deadline itself still
    // delivers and `beginSend` still accepts it. A pass that clears this gate
    // is therefore always inside the deadline its intent carries, which is
    // what lets the completed-claim recovery adopt a proven delivery through
    // `beginSend` without tripping the freshness guard.
    expect(isPostmatchReportStale(GAME_CREATION, deadline)).toBe(false);
    expect(
      isPostmatchReportStale(GAME_CREATION, new Date(deadline.getTime() + 1)),
    ).toBe(true);
  });

  test("the deadline is the match's own age limit, not the pass's", () => {
    // Keyed to gameCreation rather than to when this pass happens to run, so
    // every pass over one match agrees on the same instant.
    expect(postmatchReportFreshnessDeadline(GAME_CREATION).getTime()).toBe(
      GAME_CREATION + MAX_DISCORD_ALERT_AGE_MS,
    );
  });
});
