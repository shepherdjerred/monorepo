import { describe, expect, test } from "bun:test";
import {
  appendBucksLine,
  bucksPrematchLine,
  bucksPrematchSummary,
} from "#src/betting/prematch-line.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";

describe("bucksPrematchLine", () => {
  test("publishes the house policy without leaking prediction percentages", () => {
    const line = bucksPrematchLine();
    expect(line).toBe(HOUSE_CUT_TERMS);
    expect(line).not.toContain("estimate");
    expect(line).not.toContain("Scout's call");
  });

  test("does not add blank content when there is no footer", () => {
    expect(appendBucksLine("Aaron and Long started a game", "")).toBe(
      "Aaron and Long started a game",
    );
  });

  test("does not prefix a text-only fallback with blank lines", () => {
    expect(appendBucksLine("", HOUSE_CUT_TERMS)).toBe(HOUSE_CUT_TERMS);
  });

  test("keeps the house policy when the base reaches Discord's limit", () => {
    const message = appendBucksLine("x".repeat(2000), HOUSE_CUT_TERMS);
    expect(message).toHaveLength(2000);
    expect(message.endsWith(HOUSE_CUT_TERMS)).toBe(true);
  });
});

describe("bucksPrematchSummary", () => {
  test("shows an empty live market", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "open",
      positions: [],
    });

    expect(summary).toContain(HOUSE_CUT_TERMS);
    expect(summary).toContain("**Live offers** — No offers yet.");
  });

  test("groups named positions by team with complete totals", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "open",
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

    expect(summary).toContain("Blue **10 BB offered** · Red **5 BB offered**");
    expect(summary.indexOf("1337623164146155591")).toBeLessThan(
      summary.indexOf("1337623164146155592"),
    );
    expect(summary).toContain("**Blue Team**");
    expect(summary).toContain("**Red Team**");
  });

  test("keeps a bounded named digest and the complete team totals", () => {
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
      positions,
      houseMatches: [{ teamId: 200, matchedStake: 5 }],
    });
    const content = appendBucksLine("x".repeat(2000), summary);

    expect(summary).toContain("Blue **45 BB** · Red **45 BB**");
    expect(summary).toContain("…and 2 more position(s).");
    expect(summary).toContain("**Final matched stakes**");
    expect(content).toHaveLength(2000);
  });

  test("trims maximum-length final allocations to Discord's limit", () => {
    const maximumStake = 2_147_483_647;
    const matchedStake = 1_073_741_824;
    const unmatchedStake = maximumStake - matchedStake;
    const positions = Array.from({ length: 15 }, (_, index) => ({
      discordId: `133762316414615${(1000 + index).toString()}`,
      teamId: index % 2 === 0 ? (100 as const) : (200 as const),
      offeredStake: maximumStake,
      matchedStake,
      unmatchedStake,
    }));
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "closed",
      positions,
    });
    const content = appendBucksLine("x".repeat(2000), summary);

    expect(summary.length).toBeLessThanOrEqual(2000);
    expect(summary).toContain("offered **2147483647 BB**");
    expect(summary).toContain("matched **1073741824 BB**");
    expect(summary).toContain("refunded **1073741823 BB**");
    expect(summary).toContain("more position(s)");
    expect(content).toHaveLength(2000);
  });

  test("shows offered, matched, refunded, and aggregate house matching", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "closed",
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
      "**Final matched stakes** — Blue **6 BB** · Red **6 BB**",
    );
    expect(summary).toContain("🏦 House matched **5 BB** on **Red Team**.");
    expect(summary).toContain(
      "offered **10 BB** · matched **6 BB** · refunded **4 BB**",
    );
  });
});
