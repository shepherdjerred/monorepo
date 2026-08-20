import { describe, expect, test } from "bun:test";
import { BucksPredictionSchema } from "@scout-for-lol/data/index.ts";
import {
  appendBucksLine,
  bucksPrematchLine,
  bucksPrematchSummary,
} from "#src/betting/prematch-line.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";

function prediction(winProbability: number) {
  return BucksPredictionSchema.parse({
    winProbability,
    subjectTeamId: 100,
    confidence: "medium",
    sentence: "Scout's call: Aaron WINS — 60%.",
    drivers: [],
  });
}

describe("bucksPrematchLine", () => {
  test("keeps an interesting call and states the complete house policy", () => {
    const line = bucksPrematchLine({ prediction: prediction(0.6) });

    expect(line).toBe(`Scout's call: Aaron WINS — 60%.\n${HOUSE_CUT_TERMS}`);
    expect(line).not.toContain("Bets close");
    expect(line).not.toContain("/bb balance");
    expect(line).not.toContain("BB:CAD");
  });

  test("omits a near-even call while leaving the market available", () => {
    expect(bucksPrematchLine({ prediction: prediction(0.49) })).toBe(
      HOUSE_CUT_TERMS,
    );
  });

  test("does not add blank content when there is no call", () => {
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
    expect(summary).toContain("**Live bets** — No bets yet.");
  });

  test("groups named positions by team with complete totals", () => {
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "open",
      positions: [
        { discordId: "1337623164146155591", teamId: 100, stake: 6 },
        { discordId: "1337623164146155592", teamId: 100, stake: 4 },
        { discordId: "1337623164146155593", teamId: 200, stake: 5 },
      ],
    });

    expect(summary).toContain("Blue **10 BB** · Red **5 BB**");
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
      stake: 5,
    }));
    const summary = bucksPrematchSummary({
      prediction: undefined,
      poolState: "closed",
      positions,
    });
    const content = appendBucksLine("x".repeat(2000), summary);

    expect(summary).toContain("Blue **45 BB** · Red **40 BB**");
    expect(summary).toContain("…and 2 more position(s).");
    expect(summary).toContain("**Final bets**");
    expect(content).toHaveLength(2000);
  });
});
