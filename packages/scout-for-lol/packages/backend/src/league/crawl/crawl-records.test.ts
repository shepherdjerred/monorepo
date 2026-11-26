import { describe, expect, test } from "vitest";
import { z } from "zod";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  CHECKPOINT_TIMES_MS,
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

function participantFrame(participantId: number, totalGold: number) {
  return {
    participantId,
    totalGold,
    currentGold: 100,
    xp: 400,
    level: 3,
    minionsKilled: 10,
    jungleMinionsKilled: 2,
    position: { x: 1, y: 2 },
  };
}

describe("timeline reduction", () => {
  const timeline = {
    info: {
      participants: [{ participantId: 1, puuid: P("p1") }],
      frames: [
        {
          timestamp: 60_000,
          participantFrames: { "1": participantFrame(1, 500) },
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
          timestamp: 120_000,
          participantFrames: { "1": participantFrame(1, 650) },
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
    const stored = JSON.stringify(reduced);
    expect(stored).not.toContain("participantFrames");
    expect(stored).not.toContain("position");
    expect(stored).not.toContain("currentGold");
  });

  test("fails loudly on a timeline without frames", () => {
    expect(() => reduceTimeline({ info: {} })).toThrow();
  });
});

/**
 * A real League-client timeline (`testdata/lcu`, ten players, one frame about
 * every 60 seconds) wrapped in the Match-V5 envelope the crawl reads. Frame
 * timestamps carry the real jitter: the frame "at 10 minutes" is stamped 600249 ms.
 */
const FixtureTimelineSchema = z.object({
  frames: z.array(
    z.looseObject({
      timestamp: z.number(),
      participantFrames: z.record(z.string(), z.looseObject({})),
    }),
  ),
});

async function fixtureTimeline(name: string) {
  const raw = FixtureTimelineSchema.parse(
    await Bun.file(
      new URL(`../../../../../testdata/lcu/${name}.json`, import.meta.url),
    ).json(),
  );
  const participants = Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    puuid: P(`player${(index + 1).toString()}`),
  }));
  return { frames: raw.frames, participants };
}

function timelineOf(
  fixture: Awaited<ReturnType<typeof fixtureTimeline>>,
  frames = fixture.frames,
) {
  return { info: { participants: fixture.participants, frames } };
}

function economy(
  frame: { participantFrames: Record<string, unknown> } | undefined,
  participantId: number,
) {
  const parsed = z
    .object({
      totalGold: z.number(),
      xp: z.number(),
      minionsKilled: z.number(),
      jungleMinionsKilled: z.number(),
    })
    .parse(frame?.participantFrames[participantId.toString()]);
  return {
    participantId,
    totalGold: parsed.totalGold,
    xp: parsed.xp,
    minions: parsed.minionsKilled + parsed.jungleMinionsKilled,
  };
}

/** The frames with the given timestamps replaced, `[from, to]` pairs. */
function restamped<Frame extends { timestamp: number }>(
  frames: readonly Frame[],
  changes: readonly (readonly [number, number])[],
): Frame[] {
  const to = new Map(changes);
  return frames.map((frame) => ({
    ...frame,
    timestamp: to.get(frame.timestamp) ?? frame.timestamp,
  }));
}

describe("timeline checkpoints", () => {
  test("keeps all ten participants at the frames about 10 and 15 minutes", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-ranked-solo");
    const { checkpoints } = reduceTimeline(timelineOf(fixture));

    expect(CHECKPOINT_TIMES_MS).toEqual([600_000, 900_000]);
    expect(checkpoints?.map(({ atMs, frameMs }) => [atMs, frameMs])).toEqual([
      // Riot stamps each minute's frame just after it, so the checkpoint is
      // the first frame at or after T, never the one a minute earlier.
      [600_000, 600_249],
      [900_000, 900_303],
    ]);
    for (const checkpoint of checkpoints ?? []) {
      const frame = fixture.frames.find(
        (candidate) => candidate.timestamp === checkpoint.frameMs,
      );
      expect(checkpoint.participants).toEqual(
        Array.from({ length: 10 }, (_, index) => economy(frame, index + 1)),
      );
    }
    // The values are the frame's own, not placeholders.
    expect(checkpoints?.[1]?.participants[0]?.totalGold).toBeGreaterThan(
      checkpoints?.[0]?.participants[0]?.totalGold ?? Infinity,
    );
  });

  test("reads a frame stamped exactly on the checkpoint, minions summed", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-ranked-solo");
    const frames = restamped(fixture.frames, [
      [600_249, 600_000],
      [900_303, 900_000],
    ]);
    const { checkpoints } = reduceTimeline(timelineOf(fixture, frames));
    expect(checkpoints?.map((checkpoint) => checkpoint.frameMs)).toEqual([
      600_000, 900_000,
    ]);
    const exact = frames.find((frame) => frame.timestamp === 600_000);
    expect(checkpoints?.[0]?.participants[3]).toEqual(economy(exact, 4));
    expect(checkpoints?.[0]?.participants[3]?.minions).toBeGreaterThan(0);
  });

  test("reads a frame stamped just after the checkpoint, up to but not including 60 seconds", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-ranked-solo");
    const late = restamped(fixture.frames, [
      [600_249, 659_999],
      [900_303, 900_001],
    ]);
    expect(
      reduceTimeline(timelineOf(fixture, late)).checkpoints?.map(
        (checkpoint) => checkpoint.frameMs,
      ),
    ).toEqual([659_999, 900_001]);

    // At exactly T + 60000 the frame belongs to the next minute: no checkpoint.
    const next = restamped(fixture.frames, [[600_249, 660_000]]);
    expect(
      reduceTimeline(timelineOf(fixture, next)).checkpoints?.map(
        ({ atMs }) => atMs,
      ),
    ).toEqual([900_000]);
  });

  test("takes the earliest frame when two fall in the window", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-ranked-solo");
    const extra = fixture.frames.find((frame) => frame.timestamp === 600_249);
    if (extra === undefined) throw new Error("fixture has no 600249 frame");
    const frames = [
      ...fixture.frames,
      { ...extra, timestamp: 630_000, participantFrames: {} },
    ];
    expect(
      reduceTimeline(timelineOf(fixture, frames)).checkpoints?.[0]?.frameMs,
    ).toBe(600_249);
  });

  test("a game that ends between the checkpoints has only the 10-minute one", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-ranked-solo");
    const frames = fixture.frames.filter((frame) => frame.timestamp < 720_000);
    const { checkpoints } = reduceTimeline(timelineOf(fixture, frames));
    expect(checkpoints?.map(({ atMs }) => atMs)).toEqual([600_000]);
  });

  test("a game shorter than 10 minutes states no checkpoint and is never given an earlier frame", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-bot-custom");
    expect(fixture.frames.at(-1)?.timestamp).toBeLessThan(600_000);
    expect(reduceTimeline(timelineOf(fixture)).checkpoints).toEqual([]);
  });

  test("a game that ends before the checkpoint frame gets nothing for it", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-ranked-solo");
    // The last frame is 540219: the game ended before 10:00.
    const frames = fixture.frames.filter((frame) => frame.timestamp < 600_000);
    expect(reduceTimeline(timelineOf(fixture, frames)).checkpoints).toEqual([]);
  });

  test("a missing frame gives no checkpoint and no neighbouring frame stands in", async () => {
    const fixture = await fixtureTimeline("lcu-timeline-ranked-solo");
    const frames = fixture.frames.filter(
      (frame) => frame.timestamp !== 600_249,
    );
    const { checkpoints } = reduceTimeline(timelineOf(fixture, frames));
    expect(checkpoints?.map(({ atMs, frameMs }) => [atMs, frameMs])).toEqual([
      [900_000, 900_303],
    ]);
  });

  test("a timeline with no frames has no checkpoints", () => {
    expect(
      reduceTimeline({ info: { participants: [], frames: [] } }).checkpoints,
    ).toEqual([]);
  });

  test("fails loudly on a frame without participant frames", () => {
    expect(() =>
      reduceTimeline({ info: { frames: [{ timestamp: 0, events: [] }] } }),
    ).toThrow();
  });
});
