import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/parse/compile.ts";
import {
  emptyResultReason,
  queueLiteralsInPredicate,
} from "#src/explore/empty-result-reason.ts";

/** Compile real ScoutQL so the walker is tested against genuine plans. */
function reasonFor(queryText: string): string | null {
  return emptyResultReason(compileScoutQl(queryText));
}

function queuesFor(queryText: string): readonly string[] {
  return queueLiteralsInPredicate(compileScoutQl(queryText).where);
}

describe("queueLiteralsInPredicate", () => {
  test("reads an equality filter on queue", () => {
    expect(
      queuesFor(
        "SELECT COUNT(*) AS games FROM match_participants WHERE queue = 'aram mayhem'",
      ),
    ).toEqual(["aram mayhem"]);
  });

  test("reads an IN list and keeps other conjuncts out of it", () => {
    expect(
      queuesFor(
        "SELECT COUNT(*) AS games FROM match_participants WHERE queue IN ('aram mayhem', 'classic') AND kills > 5",
      ),
    ).toEqual(["aram mayhem", "classic"]);
  });

  test("ignores a negated filter, which excludes rather than selects", () => {
    expect(
      queuesFor(
        "SELECT COUNT(*) AS games FROM match_participants WHERE queue NOT IN ('aram mayhem')",
      ),
    ).toEqual([]);
  });
});

describe("emptyResultReason", () => {
  test("explains a query pinned to a pre-match-only queue", () => {
    const reason = reasonFor(
      "SELECT COUNT(*) AS games FROM match_participants WHERE queue = 'aram mayhem'",
    );
    expect(reason).toContain("can never return rows");
    expect(reason).toContain("'aram mayhem'");
    expect(reason).toContain("do not retry it narrower");
  });

  test("explains every pre-match-only queue in an IN list", () => {
    const reason = reasonFor(
      "SELECT COUNT(*) AS games FROM match_participants WHERE queue IN ('aram mayhem', 'classic')",
    );
    expect(reason).toContain("'aram mayhem' and 'classic'");
    expect(reason).toContain("those modes");
  });

  test("stays silent when the query could legitimately have matched", () => {
    expect(
      reasonFor(
        "SELECT COUNT(*) AS games FROM match_participants WHERE queue = 'aram'",
      ),
    ).toBeNull();
    expect(
      reasonFor("SELECT COUNT(*) AS games FROM match_participants"),
    ).toBeNull();
  });

  test("stays silent when a scorable queue is also allowed", () => {
    // Emptiness here has ordinary explanations, so claiming impossibility
    // would be a new wrong answer rather than a fix for the old one.
    expect(
      reasonFor(
        "SELECT COUNT(*) AS games FROM match_participants WHERE queue IN ('aram mayhem', 'aram')",
      ),
    ).toBeNull();
  });

  test("does not mistake Classic ARAM Mayhem for ARAM Mayhem", () => {
    expect(
      reasonFor(
        "SELECT COUNT(*) AS games FROM match_participants WHERE queue = 'classic aram mayhem'",
      ),
    ).toBeNull();
  });
});
