import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/parse/compile.ts";
import {
  emptyResultReason,
  queueConstraintOf,
} from "#src/explore/empty-result-reason.ts";

/** Compile real ScoutQL so the walker is tested against genuine plans. */
function reasonFor(queryText: string): string | null {
  return emptyResultReason(compileScoutQl(queryText));
}

function constraintFor(queryText: string): readonly string[] | null {
  const constraint = queueConstraintOf(compileScoutQl(queryText).where);
  return constraint === null ? null : [...constraint].sort();
}

const COUNT_GAMES = "SELECT COUNT(*) AS games FROM match_participants";

describe("queueConstraintOf", () => {
  test("reads an equality filter on queue", () => {
    expect(constraintFor(`${COUNT_GAMES} WHERE queue = 'classic'`)).toEqual([
      "classic",
    ]);
  });

  test("reads an IN list", () => {
    expect(
      constraintFor(`${COUNT_GAMES} WHERE queue IN ('classic', 'aram')`),
    ).toEqual(["aram", "classic"]);
  });

  test("narrows across AND and ignores unrelated conjuncts", () => {
    expect(
      constraintFor(`${COUNT_GAMES} WHERE queue = 'classic' AND kills > 5`),
    ).toEqual(["classic"]);
  });

  test("widens across OR", () => {
    expect(
      constraintFor(
        `${COUNT_GAMES} WHERE queue = 'classic' OR queue = 'aram mayhem'`,
      ),
    ).toEqual(["aram mayhem", "classic"]);
  });

  test("an OR branch that does not mention queue admits every queue", () => {
    // The whole point: this predicate still matches an ARAM game with 51
    // kills, so nothing about the queue is proven.
    expect(
      constraintFor(`${COUNT_GAMES} WHERE queue = 'classic' OR kills > 50`),
    ).toBeNull();
  });

  test("ignores a negated filter, which excludes rather than selects", () => {
    expect(
      constraintFor(`${COUNT_GAMES} WHERE queue NOT IN ('classic')`),
    ).toBeNull();
  });
});

describe("emptyResultReason", () => {
  test("explains a query pinned to a pre-match-only queue", () => {
    const reason = reasonFor(`${COUNT_GAMES} WHERE queue = 'classic'`);
    expect(reason).toContain("can never return rows");
    expect(reason).toContain("'classic'");
    expect(reason).toContain("do not retry it narrower");
  });

  test("explains both pre-match-only queues when an OR covers only those", () => {
    const reason = reasonFor(
      `${COUNT_GAMES} WHERE queue = 'classic' OR queue = 'aram mayhem'`,
    );
    expect(reason).toContain("those modes");
  });

  test("stays silent when an OR branch admits other queues", () => {
    // Claiming impossibility here would be a new wrong answer, not a fix.
    expect(
      reasonFor(`${COUNT_GAMES} WHERE queue = 'classic' OR kills > 50`),
    ).toBeNull();
  });

  test("stays silent on the pre-match source, which does hold those games", () => {
    // Pre-match rows exist in quantity for exactly these queues — prod holds
    // 4,686 ARAM Mayhem observations — so an empty result there is about the
    // player or the dates, not the mode.
    expect(
      reasonFor(
        "SELECT COUNT(*) AS games FROM prematch_participants WHERE queue = 'aram mayhem'",
      ),
    ).toBeNull();
  });

  test("stays silent when the query could legitimately have matched", () => {
    expect(reasonFor(`${COUNT_GAMES} WHERE queue = 'aram'`)).toBeNull();
    expect(reasonFor(COUNT_GAMES)).toBeNull();
    expect(
      reasonFor(`${COUNT_GAMES} WHERE queue IN ('classic', 'aram')`),
    ).toBeNull();
  });

  test("treats Classic ARAM Mayhem as the scorable one of the three", () => {
    expect(
      reasonFor(`${COUNT_GAMES} WHERE queue = 'classic aram mayhem'`),
    ).toBeNull();
  });

  test("explains a query pinned to ARAM Clash", () => {
    const reason = reasonFor(`${COUNT_GAMES} WHERE queue = 'aram clash'`);
    expect(reason).toContain("can never return rows");
    expect(reason).toContain("'aram clash'");
  });

  test("stays silent on Summoner's Rift Clash, which has finished matches", () => {
    expect(reasonFor(`${COUNT_GAMES} WHERE queue = 'clash'`)).toBeNull();
  });
});
