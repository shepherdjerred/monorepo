import {
  RawCurrentGameInfoSchema,
  RawMatchSchema,
  RawTimelineSchema,
  type RawCurrentGameInfo,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
  type ArtifactKind,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";

/**
 * The three raw captures an ingest handles, as test fixtures.
 *
 * Every suite that exercises archival, staging or receipts needs the same
 * three payloads, and hand-rolling them per file produced byte-identical
 * blocks that duplication detection correctly objected to. Sharing them also
 * means a schema change breaks one place rather than five.
 */

const MATCH_FIXTURE_URL = new URL(
  "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
  import.meta.url,
);

/** The committed MatchV5 payload, parsed through the production schema. */
export async function loadRawMatchFixture(): Promise<RawMatch> {
  const json: unknown = await Bun.file(MATCH_FIXTURE_URL).json();
  return RawMatchSchema.parse(json);
}

/**
 * A minimal timeline for `matchId`. Frames are empty by default because most
 * callers only care about identity and partitioning; pass `frameIntervalMs` to
 * tell two otherwise identical timelines apart.
 */
export function rawTimelineFixture(
  matchId: string,
  overrides: { frameIntervalMs?: number } = {},
): RawTimeline {
  return RawTimelineSchema.parse({
    metadata: { dataVersion: "2", matchId, participants: [] },
    info: {
      frameInterval: overrides.frameIntervalMs ?? 60_000,
      frames: [],
      gameId: Number(matchId.split("_").at(1)),
      participants: [],
    },
  });
}

/** A spectator snapshot whose platform and game id form `NA1_5500000001`. */
export function rawCurrentGameInfoFixture(): RawCurrentGameInfo {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_500_000_001,
    gameStartTime: Date.now(),
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: -30,
    platformId: "NA1",
    bannedChampions: [],
    participants: [
      {
        championId: 157,
        puuid: "test-puuid",
        teamId: 100,
        riotId: "Player#NA1",
        spell1Id: 4,
        spell2Id: 14,
        lastSelectedSkinIndex: 0,
        bot: false,
        profileIconId: 1,
      },
    ],
  });
}

/**
 * A spectator snapshot with a complete ten-player roster, `trackedPuuids`
 * seated first.
 *
 * {@link rawCurrentGameInfoFixture} carries one participant, which
 * `isPrematchRosterComplete` correctly refuses as a lobby that has not finished
 * loading in. Any suite driving the capture past that gate needs ten, and the
 * nine seats after the tracked ones are filler.
 */
export function fullPrematchRosterFixture(
  trackedPuuids: readonly string[],
): RawCurrentGameInfo {
  const base = rawCurrentGameInfoFixture();
  const seat = base.participants[0];
  if (seat === undefined) {
    throw new Error("The spectator fixture lost its participant template");
  }
  return RawCurrentGameInfoSchema.parse({
    ...base,
    gameLength: 12,
    participants: Array.from({ length: 10 }, (_unused, index) => ({
      ...seat,
      puuid: trackedPuuids[index] ?? `filler-puuid-${index.toString()}`,
      teamId: index < 5 ? 100 : 200,
      championId: index + 1,
      riotId: `Player${index.toString()}#NA1`,
    })),
  });
}

/** A descriptor standing in for an object some earlier step archived. */
export function artifactDescriptorFixture(
  kind: ArtifactKind,
): ArtifactDescriptor {
  return ArtifactDescriptorSchema.parse({
    kind,
    key: `games/2026/09/12/NA1_5370969615/${kind}.json`,
    digest: "b".repeat(64),
    bytes: 2048,
    contentType: "application/json",
    capturedAt: "2026-09-12T12:00:00.000Z",
  });
}
