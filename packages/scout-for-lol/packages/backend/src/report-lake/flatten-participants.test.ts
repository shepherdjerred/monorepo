import {
  MatchLakeRowSchema,
  PrematchLakeRowSchema,
  RawMatchSchema,
  SCOUT_CLIENT_DATA_VERSION,
  type MatchLakeRow,
  type RawCurrentGameInfo,
  type RawMatch,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import { flattenMatch, flattenPrematch } from "#src/report-lake/flatten.ts";
import { flattenTimeline } from "#src/report-lake/flatten-timeline.ts";
import { convertLcuMatchBundle } from "#src/scout-client/canonical/lcu-match.ts";
import { convertLcuTimeline } from "#src/scout-client/canonical/lcu-timeline.ts";
import { lcuParticipantIdentity } from "#src/scout-client/canonical/lcu-identity.ts";
import {
  lcuUuidsIn,
  translatePayloadIdentities,
} from "#src/scout-client/identity-alias.ts";
import {
  LcuBundleFixtureSchema,
  lcuAliasesFor,
  lcuBotBundle,
  lcuBundleMatchId,
  rawLcuFixture,
  withLcuTiming,
} from "#src/testing/report-lake/lcu-bundle-fixtures.ts";

const LCU_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

const riot = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

/** The Riot fixture as a client would build it with a bot and an unaliased player. */
function scoutBuiltWithNonPlayers(match: RawMatch): RawMatch {
  const participants = match.info.participants.map((participant, index) =>
    index === 0
      ? { ...participant, puuid: null, participantKind: "bot" as const }
      : index === 1
        ? {
            ...participant,
            puuid: null,
            participantKind: "unresolved" as const,
            leagueClientUuid: LCU_UUID,
          }
        : { ...participant, participantKind: "player" as const },
  );
  return RawMatchSchema.parse({
    metadata: {
      ...match.metadata,
      dataVersion: SCOUT_CLIENT_DATA_VERSION,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: { ...match.info, participants },
  });
}

/** Every row must satisfy the lake's own row contract, as staging checks. */
function expectValidRows(rows: readonly MatchLakeRow[]): void {
  for (const row of rows) {
    expect(MatchLakeRowSchema.safeParse(row).success).toBe(true);
  }
}

function kinds(rows: readonly MatchLakeRow[]) {
  return rows.map((row) => [row.participant_kind, row.puuid === null]);
}

describe("flattenMatch writes every participant", () => {
  test("a Riot match writes one complete player row per participant", () => {
    const rows = flattenMatch(riot);

    expect(rows.map((row) => row.puuid)).toEqual(
      riot.info.participants.map((participant) => participant.puuid),
    );
    expect(new Set(rows.map((row) => row.participant_kind))).toEqual(
      new Set(["player"]),
    );
    expect(new Set(rows.map((row) => row.coverage))).toEqual(
      new Set(["complete"]),
    );
    expectValidRows(rows);
  });

  test("a bot and an unresolved player get rows with a NULL puuid and their kind", () => {
    const rows = flattenMatch(scoutBuiltWithNonPlayers(riot));

    expect(rows).toHaveLength(riot.info.participants.length);
    expect(kinds(rows).slice(0, 3)).toEqual([
      ["bot", true],
      ["unresolved", true],
      ["player", false],
    ]);
    // Their statistics are kept exactly; only the identity is withheld.
    expect(rows[0]?.kills).toBe(riot.info.participants[0]?.kills);
    expect(rows[1]?.participant_id).toBe(
      riot.info.participants[1]?.participantId,
    );
    // The League-client UUID stays in the stored document, never the lake.
    expect(JSON.stringify(rows)).not.toContain(LCU_UUID);
    expectValidRows(rows);
  });

  test("a converted Classic game with five bots writes ten rows", async () => {
    const bots = [6, 7, 8, 9, 10];
    const bundle = await lcuBotBundle(bots);
    const match = convertLcuMatchBundle(lcuBundleMatchId(bundle), bundle);
    if (match === null) throw new Error("Bot fixture must convert");
    const rows = flattenMatch(match);

    expect(rows).toHaveLength(10);
    for (const row of rows) {
      const bot =
        row.participant_id !== null && bots.includes(row.participant_id);
      expect([row.participant_kind, row.puuid === null]).toEqual(
        bot ? ["bot", true] : ["player", false],
      );
    }
    expect(new Set(rows.map((row) => row.data_source))).toEqual(
      new Set(["SCOUT_CLIENT"]),
    );
    expectValidRows(rows);
  });

  test("a converted game with no aliases writes unresolved rows and no UUID", async () => {
    const raw = await rawLcuFixture("lcu-postgame-classic");
    const bundle = withLcuTiming(LcuBundleFixtureSchema.parse(raw));
    const match = convertLcuMatchBundle(lcuBundleMatchId(bundle), bundle);
    if (match === null) throw new Error("Unaliased fixture must convert");
    const rows = flattenMatch(match);

    expect(kinds(rows)).toEqual(
      Array.from({ length: 10 }, () => ["unresolved", true]),
    );
    const text = JSON.stringify(rows);
    for (const uuid of lcuUuidsIn(raw)) {
      expect(text).not.toContain(uuid);
    }
  });
});

describe("flattenTimeline writes every participant's frames", () => {
  test("a bot custom keeps bot frames by slot with a NULL puuid", async () => {
    const rawGame = await rawLcuFixture("lcu-game-bot-custom");
    const aliases = lcuAliasesFor(rawGame);
    const timeline = convertLcuTimeline(
      RiotMatchIdSchema.parse("NA1_1"),
      translatePayloadIdentities(rawGame, aliases),
      translatePayloadIdentities(
        await rawLcuFixture("lcu-timeline-bot-custom"),
        aliases,
      ),
    );
    if (timeline === null) throw new Error("Bot custom timeline must convert");
    const flattened = flattenTimeline(timeline, new Date(0));
    const players = new Map(
      timeline.info.participants.map((participant) => [
        participant.participantId,
        participant.puuid,
      ]),
    );
    const lastFrame = Math.max(
      ...flattened.participantFrames.map((frame) => frame.frame_index),
    );

    // One player and nine bots, every one of them with frames.
    expect(
      flattened.participantFrames
        .filter((frame) => frame.frame_index === lastFrame)
        .map((frame) => [frame.participant_id, frame.puuid])
        .toSorted(([left], [right]) => Number(left) - Number(right)),
    ).toEqual(
      [...players.entries()].toSorted(([left], [right]) => left - right),
    );
    expect(
      [...players.values()].filter((puuid) => puuid !== null),
    ).toHaveLength(1);
    for (const row of flattened.eventParticipants) {
      expect(row.puuid).toBe(players.get(row.participant_id) ?? null);
    }
  });
});

describe("flattenPrematch", () => {
  const hidden = {
    championId: 266,
    puuid: null,
    teamId: 200,
    // Riot's stand-in for a privacy-scrubbed Riot ID: the champion's name.
    riotId: "Aatrox",
    spell1Id: 4,
    spell2Id: 7,
    lastSelectedSkinIndex: 0,
    bot: false,
    profileIconId: 1,
  };
  const gameInfo: RawCurrentGameInfo = {
    gameId: 123,
    gameStartTime: 0,
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: -30,
    platformId: "NA1",
    participants: [
      {
        ...hidden,
        championId: 1,
        puuid: "p".repeat(78),
        teamId: 100,
        riotId: "Player#NA1",
      },
      hidden,
      { ...hidden, championId: 2, riotId: "Annie Bot", bot: true },
    ],
    bannedChampions: [],
  };
  const rows = flattenPrematch(gameInfo, new Date("2026-07-01T12:00:00Z"));

  test("a bot gets a row with a NULL puuid", () => {
    expect(rows.map((row) => [row.puuid, row.bot, row.champion_id])).toEqual([
      ["p".repeat(78), false, 1],
      [null, true, 2],
    ]);
    for (const row of rows) {
      expect(PrematchLakeRowSchema.safeParse(row).success).toBe(true);
    }
  });

  test("a hidden player stays hidden: no row, and no stand-in name", () => {
    expect(rows.some((row) => row.champion_id === hidden.championId)).toBe(
      false,
    );
    expect(JSON.stringify(rows)).not.toContain("Aatrox");
  });

  test("a League-client entry with no identity never becomes one", () => {
    // Neither a player nor a bot nor an unaliased UUID: nobody to name.
    expect(lcuParticipantIdentity("", false)).toBeNull();
    expect(lcuParticipantIdentity("", undefined)).toBeNull();
    expect(lcuParticipantIdentity("hidden", false)).toBeNull();
    expect(lcuParticipantIdentity(LCU_UUID, true)).toBeNull();
  });
});
