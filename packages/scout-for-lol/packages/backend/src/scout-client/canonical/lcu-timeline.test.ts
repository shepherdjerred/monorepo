import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  lcuUuidsIn,
  translatePayloadIdentities,
} from "#src/scout-client/identity-alias.ts";
import { convertLcuTimeline } from "./lcu-timeline.ts";

/**
 * Real League-client payloads, captured from `/lol-match-history/v1/games/{id}`
 * and `/game-timelines/{id}` and redacted: every player UUID is a stable fake,
 * every name a placeholder.
 */
async function fixture(name: string): Promise<unknown> {
  return Bun.file(
    new URL(`../../../../../testdata/lcu/${name}.json`, import.meta.url),
  ).json();
}

/** Stand-ins for the alias table: each fake UUID to a 78-character PUUID. */
function aliasesFor(game: unknown): ReadonlyMap<string, string> {
  return new Map(
    [...lcuUuidsIn(game)].map((uuid) => [uuid, `${uuid}-${"p".repeat(41)}`]),
  );
}

async function converted(mode: string) {
  const rawGame = await fixture(`lcu-game-${mode}`);
  const identities = aliasesFor(rawGame);
  const game = translatePayloadIdentities(rawGame, identities);
  const timeline = translatePayloadIdentities(
    await fixture(`lcu-timeline-${mode}`),
    identities,
  );
  return {
    game,
    rawTimeline: await fixture(`lcu-timeline-${mode}`),
    result: convertLcuTimeline(
      RiotMatchIdSchema.parse("NA1_1"),
      game,
      timeline,
    ),
  };
}

describe("convertLcuTimeline", () => {
  test("converts a ranked game's full per-minute timeline", async () => {
    const { result, rawTimeline } = await converted("ranked-solo");

    expect(result).not.toBeNull();
    expect(result?.metadata.dataVersion).toBe("local-1");
    expect(result?.metadata.participants).toHaveLength(10);
    expect(result?.info.frameInterval).toBe(60_000);
    const frames = result?.info.frames ?? [];
    expect(frames).toHaveLength(
      z.object({ frames: z.array(z.unknown()) }).parse(rawTimeline).frames
        .length,
    );
    for (const frame of frames.slice(1)) {
      expect(Object.keys(frame.participantFrames ?? {})).toHaveLength(10);
    }
  });

  test("keeps every per-minute fact the League client reports", async () => {
    const { result } = await converted("ranked-solo");
    const frame = result?.info.frames[10]?.participantFrames?.["1"];

    expect(frame).toMatchObject({
      currentGold: expect.any(Number),
      totalGold: expect.any(Number),
      xp: expect.any(Number),
      level: expect.any(Number),
      minionsKilled: expect.any(Number),
      jungleMinionsKilled: expect.any(Number),
      position: { x: expect.any(Number), y: expect.any(Number) },
    });
    // What the League client never reports stays absent, never zero.
    expect(frame?.goldPerSecond).toBeUndefined();
    expect(frame?.timeEnemySpentControlled).toBeUndefined();
    expect(frame).not.toHaveProperty("dominionScore");
  });

  test("keeps only the fields Match-V5 gives each event type", async () => {
    const { result } = await converted("ranked-solo");
    const events = result?.info.frames.flatMap((frame) => frame.events) ?? [];
    const kill = events.find((event) => event.type === "CHAMPION_KILL");
    const building = events.find((event) => event.type === "BUILDING_KILL");
    const monster = events.find((event) => event.type === "ELITE_MONSTER_KILL");

    expect(kill).toMatchObject({
      killerId: expect.any(Number),
      victimId: expect.any(Number),
    });
    // The League client zero-fills these on a kill; they're not facts.
    expect(kill?.buildingType).toBeUndefined();
    expect(kill?.itemId).toBeUndefined();
    expect(building).toMatchObject({
      buildingType: expect.any(String),
      laneType: expect.any(String),
      teamId: expect.any(Number),
    });
    expect([100, 200]).toContain(monster?.killerTeamId);
    expect(monster?.monsterType).toEqual(expect.any(String));
  });

  test("converts ARAM Mayhem and Arena, which Riot's API never returns", async () => {
    const mayhem = await converted("aram-mayhem");
    const arena = await converted("arena");

    expect(mayhem.result?.metadata.participants).toHaveLength(10);
    expect(arena.result?.metadata.participants).toHaveLength(18);
  });

  test("keeps players with no alias yet unresolved, never as a PUUID", async () => {
    // A League-client UUID read as a PUUID would join to nothing, or to the
    // wrong rows; it stays out of `puuid` and out of the metadata.
    const rawGame = await fixture("lcu-game-ranked-solo");
    const result = convertLcuTimeline(
      RiotMatchIdSchema.parse("NA1_1"),
      rawGame,
      await fixture("lcu-timeline-ranked-solo"),
    );

    expect(result?.metadata.participants).toEqual([]);
    expect(result?.info.participants).toHaveLength(10);
    const uuids = [...lcuUuidsIn(rawGame)];
    for (const participant of result?.info.participants ?? []) {
      expect(participant.puuid).toBeNull();
      expect(participant.participantKind).toBe("unresolved");
      expect(uuids).toContain(participant.leagueClientUuid);
    }
  });

  test("converts a bot game, naming each bot by kind alone", async () => {
    // Every bot carries the all-zero League-client UUID, which names nobody.
    const { result } = await converted("bot-custom");

    expect(result).not.toBeNull();
    const kinds = result?.info.participants.map(
      (participant) => participant.participantKind,
    );
    expect(kinds?.filter((kind) => kind === "player")).toHaveLength(1);
    expect(kinds?.filter((kind) => kind === "bot")).toHaveLength(9);
    expect(result?.metadata.participants).toHaveLength(1);
    for (const participant of result?.info.participants ?? []) {
      if (participant.participantKind === "bot") {
        expect(participant.puuid).toBeNull();
        expect(participant.leagueClientUuid).toBeUndefined();
      }
    }
  });
});
