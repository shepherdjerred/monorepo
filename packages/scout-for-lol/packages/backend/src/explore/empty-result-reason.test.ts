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

const COUNT_GAMES = "SELECT COUNT(*) AS games FROM match_participants";

describe("queueLiteralsInPredicate", () => {
  test("reads an equality filter on queue", () => {
    expect(queuesFor(`${COUNT_GAMES} WHERE queue = 'classic'`)).toEqual([
      "classic",
    ]);
  });

  test("reads an IN list and keeps other conjuncts out of it", () => {
    expect(
      queuesFor(
        `${COUNT_GAMES} WHERE queue IN ('classic', 'aram') AND kills > 5`,
      ),
    ).toEqual(["classic", "aram"]);
  });

  test("ignores a negated filter, which excludes rather than selects", () => {
    expect(queuesFor(`${COUNT_GAMES} WHERE queue NOT IN ('classic')`)).toEqual(
      [],
    );
  });
});

describe("emptyResultReason", () => {
  test("explains a query pinned to a pre-match-only queue", () => {
    const reason = reasonFor(`${COUNT_GAMES} WHERE queue = 'classic'`);
    expect(reason).toContain("can never return rows");
    expect(reason).toContain("'classic'");
    expect(reason).toContain("that mode");
    expect(reason).toContain("do not retry it narrower");
  });

  test("explains a single-queue IN list the same way", () => {
    expect(reasonFor(`${COUNT_GAMES} WHERE queue IN ('classic')`)).toContain(
      "can never return rows",
    );
  });

  test("stays silent when the query could legitimately have matched", () => {
    expect(reasonFor(`${COUNT_GAMES} WHERE queue = 'aram'`)).toBeNull();
    expect(reasonFor(COUNT_GAMES)).toBeNull();
  });

  test("stays silent when a scorable queue is also allowed", () => {
    // Emptiness here has ordinary explanations, so claiming impossibility
    // would be a new wrong answer rather than a fix for the old one.
    expect(
      reasonFor(`${COUNT_GAMES} WHERE queue IN ('classic', 'aram')`),
    ).toBeNull();
  });

  test("treats both Mayhem queues as ordinary, scorable modes", () => {
    // Three confusable names; only League Classic itself withholds results.
    // Marking a quiet event mode impossible would tell users a mode cannot be
    // scored when nobody tracked has simply played it yet.
    expect(reasonFor(`${COUNT_GAMES} WHERE queue = 'aram mayhem'`)).toBeNull();
    expect(
      reasonFor(`${COUNT_GAMES} WHERE queue = 'classic aram mayhem'`),
    ).toBeNull();
  });
});
