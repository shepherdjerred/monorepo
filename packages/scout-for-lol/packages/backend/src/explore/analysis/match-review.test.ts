import { expect, test } from "vitest";
import { RawMatchSchema, RawTimelineSchema } from "@scout-for-lol/data";
import { summarizeRecordedMatch } from "./match-review.ts";

async function fixture() {
  const match = RawMatchSchema.parse(
    await Bun.file("../../testdata/rift.json").json(),
  );
  const target = match.info.participants[0];
  const killer = match.info.participants.find(
    (p) => p.teamId !== target?.teamId,
  );
  if (target === undefined || killer === undefined)
    throw new Error("Fixture lacks opposing players.");
  killer.championName = "Locke";
  target.championName = "Ezreal";
  target.deaths = 25;
  match.info.gameDuration = 180;
  match.info.participants.reverse();
  const states = Object.fromEntries(
    match.info.participants.map((p) => [
      p.participantId.toString(),
      {
        participantId: p.participantId,
        currentGold: 100,
        totalGold: p.teamId === target.teamId ? 2000 : 1000,
        jungleMinionsKilled: 0,
        minionsKilled: 10,
        level: 2,
        position: { x: 0, y: 0 },
        xp: 100,
      },
    ]),
  );
  const events = Array.from({ length: 25 }, (_, index) => ({
    type: "CHAMPION_KILL",
    timestamp: 119_000 + index,
    killerId: killer.participantId,
    victimId: target.participantId,
    bounty: 300,
    shutdownBounty: index === 0 ? 200 : 0,
  }));
  const timeline = RawTimelineSchema.parse({
    metadata: match.metadata,
    info: {
      frameInterval: 60_000,
      gameId: match.info.gameId,
      participants: match.info.participants.map((p) => ({
        participantId: p.participantId,
        puuid: p.puuid,
      })),
      frames: [
        { timestamp: 0, participantFrames: null, events: [] },
        { timestamp: 60_000, participantFrames: states, events: [] },
        { timestamp: 120_000, participantFrames: states, events: [] },
        { timestamp: 180_000, participantFrames: null, events },
      ],
    },
  });
  const data = {
    documents: [
      { matchId: match.metadata.matchId, kind: "match", document: match },
      { matchId: match.metadata.matchId, kind: "timeline", document: timeline },
    ],
  };
  return { match, timeline, target, killer, data };
}

test("joins unfamiliar killers by participant ID after roster reordering and pages every event", async () => {
  const { match, target, data } = await fixture();
  const pages = [0, 10, 20].map((offset) =>
    summarizeRecordedMatch(
      data,
      match.metadata.matchId,
      target.participantId,
      offset,
    ),
  );
  const items = pages.flatMap((page) =>
    page.ok ? page.selectedEvents.items : [],
  );
  expect(items).toHaveLength(25);
  expect(new Set(items.map((e) => e.timestampMs)).size).toBe(25);
  expect(items[0]).toMatchObject({
    gameTime: "1:59",
    bounty: 300,
    shutdownBounty: 200,
    killer: { champion: "Locke", teamId: 200 },
    victim: { champion: "Ezreal", teamId: 100 },
    precedingGoldSnapshot: {
      frameTimestampMs: 60_000,
      teamGoldDifference: 5000,
    },
  });
  expect(pages[0]).toMatchObject({
    coverage: {
      prematch: false,
      timeline: "complete",
      frames: 4,
      events: 25,
      participants: 10,
    },
    selectedEvents: { nextOffset: 10 },
  });
  expect(pages[2]).toMatchObject({ selectedEvents: { nextOffset: null } });
});

test("missing timeline keeps postmatch facts and absent coverage counts", async () => {
  const { match, target, data } = await fixture();
  const result = summarizeRecordedMatch(
    { documents: data.documents.slice(0, 1) },
    match.metadata.matchId,
    target.participantId,
    0,
  );
  expect(result).toMatchObject({
    ok: true,
    player: { champion: "Ezreal" },
    coverage: { timeline: "missing", frames: null, events: null },
    selectedEvents: { total: null, items: [] },
  });
  expect(
    summarizeRecordedMatch(data, match.metadata.matchId, 999, 0),
  ).toMatchObject({ ok: false });
});

test("unknown event identities fail loudly instead of inventing champions", async () => {
  const { match, target, timeline, data } = await fixture();
  const event = timeline.info.frames.at(-1)?.events[0];
  if (event === undefined) throw new Error("Fixture has no kill event.");
  event.killerId = 999;
  expect(() =>
    summarizeRecordedMatch(
      data,
      match.metadata.matchId,
      target.participantId,
      0,
    ),
  ).toThrow("unknown participant 999");
});

test("partial timelines retain observed events without claiming complete coverage", async () => {
  const { match, target, timeline, data } = await fixture();
  timeline.info.frames.splice(2);
  expect(
    summarizeRecordedMatch(
      data,
      match.metadata.matchId,
      target.participantId,
      0,
    ),
  ).toMatchObject({
    coverage: {
      timeline: "partial",
      frames: 2,
      events: 0,
      reason: expect.stringContaining("do not cover"),
    },
  });
});

test("a missing middle frame prevents a complete-coverage claim", async () => {
  const { match, target, timeline, data } = await fixture();
  timeline.info.frames.splice(2, 1);
  expect(
    summarizeRecordedMatch(
      data,
      match.metadata.matchId,
      target.participantId,
      0,
    ),
  ).toMatchObject({ coverage: { timeline: "partial" } });
});

test("ordinary Riot frame capture jitter retains complete coverage", async () => {
  const { match, target, timeline, data } = await fixture();
  const frame = timeline.info.frames[2];
  if (frame === undefined) throw new Error("Fixture has no middle frame.");
  frame.timestamp += 100;
  expect(
    summarizeRecordedMatch(
      data,
      match.metadata.matchId,
      target.participantId,
      0,
    ),
  ).toMatchObject({ coverage: { timeline: "complete" } });
});

test("large identity labels shrink event pages without losing events", async () => {
  const { match, target, data } = await fixture();
  for (const player of match.info.participants)
    player.riotIdGameName = "界".repeat(80);
  const collected = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = summarizeRecordedMatch(
      data,
      match.metadata.matchId,
      target.participantId,
      offset,
    );
    if (!page.ok) throw new Error(page.message);
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength,
    ).toBeLessThanOrEqual(8192);
    collected.push(...page.selectedEvents.items);
    offset = page.selectedEvents.nextOffset;
  }
  expect(collected).toHaveLength(25);
});
