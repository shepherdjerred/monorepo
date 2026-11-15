import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  isCrawlableMatch,
  parseCrawlMatchEnvelope,
  reduceTimeline,
} from "./crawl-records.ts";

const P = (name: string) => LeaguePuuidSchema.parse(name.padEnd(78, "x"));

function match(overrides: { queueId?: number; mapId?: number } = {}) {
  return {
    metadata: { matchId: "NA1_100" },
    info: {
      queueId: 420,
      mapId: 11,
      gameCreation: 1_700_000_000_000,
      participants: [{ puuid: P("p1"), championId: 1 }, { puuid: P("p2") }],
      ...overrides,
    },
  };
}

describe("crawl match envelope", () => {
  test("reads only the fields the crawl needs and tolerates the rest", () => {
    const envelope = parseCrawlMatchEnvelope(match());
    expect(envelope.info.participants.map((p) => p.puuid)).toEqual([
      P("p1"),
      P("p2"),
    ]);
  });

  test("fails loudly on a payload without participants", () => {
    expect(() =>
      parseCrawlMatchEnvelope({
        ...match(),
        info: { ...match().info, participants: [] },
      }),
    ).toThrow();
  });

  test.each([420, 440, 400])(
    "stores queue %i on Summoner's Rift",
    (queueId) => {
      expect(
        isCrawlableMatch(parseCrawlMatchEnvelope(match({ queueId }))),
      ).toBe(true);
    },
  );

  test.each([
    ["ARAM", { queueId: 450, mapId: 12 }],
    ["blind pick", { queueId: 430 }],
    ["Arena", { queueId: 1700, mapId: 30 }],
    ["draft on another map", { mapId: 12 }],
  ])("skips %s", (_name, overrides) => {
    expect(isCrawlableMatch(parseCrawlMatchEnvelope(match(overrides)))).toBe(
      false,
    );
  });
});

describe("timeline reduction", () => {
  const timeline = {
    info: {
      participants: [{ participantId: 1, puuid: P("p1") }],
      frames: [
        {
          participantFrames: { "1": { totalGold: 500 } },
          events: [
            {
              type: "ITEM_PURCHASED",
              timestamp: 30_000,
              participantId: 1,
              itemId: 1055,
            },
            { type: "CHAMPION_KILL", timestamp: 40_000, killerId: 1 },
            {
              type: "SKILL_LEVEL_UP",
              timestamp: 20_000,
              participantId: 1,
              skillSlot: 1,
              levelUpType: "NORMAL",
            },
          ],
        },
        {
          events: [
            {
              type: "ITEM_UNDO",
              timestamp: 70_000,
              participantId: 1,
              beforeId: 1055,
              afterId: 0,
              goldGain: 350,
            },
            { type: "WARD_PLACED", timestamp: 71_000, creatorId: 1 },
          ],
        },
      ],
    },
  };

  test("keeps only item and skill events, in time order", () => {
    const reduced = reduceTimeline(timeline);
    expect(reduced.events.map((event) => event.type)).toEqual([
      "SKILL_LEVEL_UP",
      "ITEM_PURCHASED",
      "ITEM_UNDO",
    ]);
    expect(reduced.events[2]).toEqual({
      t: 70_000,
      type: "ITEM_UNDO",
      participantId: 1,
      beforeId: 1055,
      afterId: 0,
      goldGain: 350,
    });
  });

  test("keeps the participant mapping and drops frames", () => {
    const reduced = reduceTimeline(timeline);
    expect(reduced.participants).toEqual([
      { participantId: 1, puuid: P("p1") },
    ]);
    expect(JSON.stringify(reduced)).not.toContain("totalGold");
  });

  test("fails loudly on a timeline without frames", () => {
    expect(() => reduceTimeline({ info: {} })).toThrow();
  });
});
