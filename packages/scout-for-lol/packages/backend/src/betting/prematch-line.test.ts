import { describe, expect, test } from "vitest";
import {
  BUCKS_RULES_HINT,
  bucksPrematchSummary,
  digestBudgetFor,
  withBucksDigest,
} from "#src/betting/prematch-line.ts";

const BLUE_ANCHOR = { anchorTeamId: 100, mixedTeams: false } as const;
const MIXED = { anchorTeamId: 100, mixedTeams: true } as const;
const CLOSES_AT = new Date("2026-08-21T00:00:00.000Z");

describe("withBucksDigest", () => {
  test("does not add blank content when there is no digest", () => {
    expect(withBucksDigest("Aaron and Long started a game", "")).toBe(
      "Aaron and Long started a game",
    );
  });

  test("does not prefix a text-only fallback with blank lines", () => {
    expect(withBucksDigest("", "🎲 **Bets open**")).toBe("🎲 **Bets open**");
  });

  // The old contract truncated the base to protect a house-cut disclosure that
  // no longer exists. Losing the players' names to protect boilerplate was the
  // wrong trade, so an over-budget digest is now a broken caller.
  test("refuses to truncate the base content", () => {
    expect(() => withBucksDigest("x".repeat(2000), "🎲 anything")).toThrow(
      "exceeds Discord's limit",
    );
  });

  test("budgets the digest against the base it will follow", () => {
    expect(digestBudgetFor("")).toBe(2000);
    expect(digestBudgetFor("x".repeat(100))).toBe(1898);
  });
});

describe("bucksPrematchSummary", () => {
  test("states no rules, only numbers and a pointer to /bb rules", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "open",
      positions: [],
      closesAt: CLOSES_AT,
    });

    expect(summary).toContain("no offers yet");
    expect(summary).toContain(BUCKS_RULES_HINT);
    expect(summary).toContain("closes <t:1787270400:R>");
    // The concepts that used to be restated on every single game.
    expect(summary).not.toContain("20%");
    expect(summary).not.toContain("maximum offer");
    expect(summary).not.toContain("rounded");
  });

  test("omits the close clause when the caller has no authoritative time", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "open",
      positions: [],
    });

    expect(summary).not.toContain("closes <t:");
  });

  test("never leaks the pregame estimate", () => {
    const summary = bucksPrematchSummary({
      prediction: {
        version: 2,
        blueWinProbability: 0.73,
        dataQuality: "high",
        coverage: { covered: 10, applicable: 10 },
        drivers: ["Blue rank edge"],
      },
      poolState: "open",
      positions: [],
      framing: BLUE_ANCHOR,
    });

    expect(summary).not.toContain("73");
    expect(summary).not.toContain("estimate");
    expect(summary).not.toContain("Scout's call");
  });

  test("names sides WIN and LOSE and inlines offers per side", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "open",
      framing: BLUE_ANCHOR,
      positions: [
        {
          discordId: "1337623164146155591",
          teamId: 100,
          offeredStake: 6,
          matchedStake: null,
          unmatchedStake: null,
        },
        {
          discordId: "1337623164146155592",
          teamId: 100,
          offeredStake: 4,
          matchedStake: null,
          unmatchedStake: null,
        },
        {
          discordId: "1337623164146155593",
          teamId: 200,
          offeredStake: 5,
          matchedStake: null,
          unmatchedStake: null,
        },
      ],
    });

    expect(summary).toContain("WIN **10 BB** · LOSE **5 BB**");
    expect(summary).toContain(
      "**WIN** <@1337623164146155591> 6 · <@1337623164146155592> 4",
    );
    expect(summary).toContain("**LOSE** <@1337623164146155593> 5");
    expect(summary.indexOf("1337623164146155591")).toBeLessThan(
      summary.indexOf("1337623164146155592"),
    );
  });

  test("falls back to Blue and Red when both teams are tracked", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "open",
      framing: MIXED,
      positions: [
        {
          discordId: "1337623164146155591",
          teamId: 100,
          offeredStake: 6,
          matchedStake: null,
          unmatchedStake: null,
        },
      ],
    });

    expect(summary).toContain("Blue **6 BB** · Red **0 BB**");
    expect(summary).not.toContain("WIN");
  });

  test("becomes a receipt at close with the full allocation arithmetic", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "closed",
      framing: BLUE_ANCHOR,
      positions: [
        {
          discordId: "1337623164146155591",
          teamId: 100,
          offeredStake: 10,
          matchedStake: 6,
          unmatchedStake: 4,
        },
        {
          discordId: "1337623164146155592",
          teamId: 200,
          offeredStake: 1,
          matchedStake: 1,
          unmatchedStake: 0,
        },
      ],
      houseMatches: [{ teamId: 200, matchedStake: 5 }],
    });

    expect(summary).toContain(
      "🎲 **Bets closed** — WIN **6 BB** · LOSE **6 BB**",
    );
    expect(summary).toContain("(house **5** on LOSE)");
    expect(summary).toContain(
      "• <@1337623164146155591> WIN 10 → matched **6**, refunded **4**",
    );
    // A fully matched offer says nothing about a zero refund.
    expect(summary).toContain(
      "• <@1337623164146155592> LOSE 1 → matched **1**",
    );
    expect(summary).not.toContain("refunded **0**");
  });

  test("reports an empty close plainly", () => {
    expect(
      bucksPrematchSummary({
        prediction: undefined,
        poolState: "closed",
        positions: [],
      }),
    ).toBe("🎲 **Bets closed** — no offers matched.");
  });

  test("bounds the digest and keeps the complete totals", () => {
    const positions = Array.from({ length: 17 }, (_, index) => ({
      discordId: `133762316414615${(1000 + index).toString()}`,
      teamId: index % 2 === 0 ? (100 as const) : (200 as const),
      offeredStake: 5,
      matchedStake: 5,
      unmatchedStake: 0,
    }));
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "closed",
      framing: BLUE_ANCHOR,
      positions,
      houseMatches: [{ teamId: 200, matchedStake: 5 }],
    });

    expect(summary).toContain("WIN **45 BB** · LOSE **45 BB**");
    expect(summary).toContain("…and 2 more.");
    expect(summary.length).toBeLessThanOrEqual(2000);
  });

  test("shrinks the digest to fit the budget the base leaves", () => {
    const positions = Array.from({ length: 15 }, (_, index) => ({
      discordId: `133762316414615${(1000 + index).toString()}`,
      teamId: index % 2 === 0 ? (100 as const) : (200 as const),
      offeredStake: 2_147_483_647,
      matchedStake: 1_073_741_824,
      unmatchedStake: 1_073_741_823,
    }));
    // A base long enough that the digest genuinely has to shrink. The new copy
    // is terse enough that fifteen max-width positions fit a bare message,
    // which the old house-cut footer could not.
    const base = "x".repeat(1000);
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "closed",
      framing: BLUE_ANCHOR,
      positions,
      maxLength: digestBudgetFor(base),
    });
    const content = withBucksDigest(base, summary);

    expect(summary).toContain("2147483647 → matched **1073741824**");
    expect(summary).toContain("more.");
    expect(summary.length).toBeLessThanOrEqual(digestBudgetFor(base));
    expect(content.length).toBeLessThanOrEqual(2000);
    // The base survives intact; only the digest shrinks.
    expect(content.startsWith(base)).toBe(true);
  });

  test("refuses a house match on an open pool", () => {
    expect(() =>
      bucksPrematchSummary({
        prediction: undefined,
        poolState: "open",
        positions: [],
        houseMatches: [{ teamId: 200, matchedStake: 5 }],
      }),
    ).toThrow("cannot contain a house match");
  });
});
