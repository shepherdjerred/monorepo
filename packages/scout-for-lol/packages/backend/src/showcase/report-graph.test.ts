import { expect, test } from "bun:test";
import {
  RawMatchSchema,
  type QueueType,
  type RawMatch,
} from "@scout-for-lol/data";
import { includeMatchForReportGraph } from "./report-graph.ts";

const fixtureUrl = new URL(
  "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
  import.meta.url,
);

async function loadMatch(): Promise<RawMatch> {
  const input: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(input);
}

test("report graph queue filters keep the two Classic modes distinct", async () => {
  const match = await loadMatch();
  const variants: readonly {
    queueId: number;
    gameMode: string;
    queueType: QueueType;
  }[] = [
    { queueId: 4310, gameMode: "CLASSIC", queueType: "classic" },
    {
      queueId: 2450,
      gameMode: "CLASSIC ARAM MAYHEM",
      queueType: "classic aram mayhem",
    },
  ];

  for (const variant of variants) {
    const candidate = RawMatchSchema.parse({
      ...match,
      info: {
        ...match.info,
        queueId: variant.queueId,
        gameMode: variant.gameMode,
      },
    });
    expect(includeMatchForReportGraph(candidate, [variant.queueType])).toBe(
      true,
    );
    expect(
      includeMatchForReportGraph(candidate, [
        variant.queueType === "classic" ? "classic aram mayhem" : "classic",
      ]),
    ).toBe(false);
  }
});
