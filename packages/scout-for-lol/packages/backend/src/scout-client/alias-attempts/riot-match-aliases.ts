import { SCOUT_CLIENT_DATA_VERSION, type RawMatch } from "@scout-for-lol/data";
import {
  type LeaguePuuid,
  LeaguePuuidSchema,
} from "@scout-for-lol/domain/identity/league-account.ts";
import { z } from "zod";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { createLogger } from "#src/logger.ts";
import { scoutClientIdentityAliasesTotal } from "#src/metrics/scout-client.ts";
import { isLcuUuid } from "#src/scout-client/identity-alias.ts";
import { settleAliasAttempt } from "./identity-alias-attempts.ts";

const logger = createLogger("scout-client-riot-match-aliases");

/** The source recorded on an alias learned from a game Riot also published. */
export const RIOT_MATCH_SOURCE = "riot_match";

/**
 * How far a stored alias outranks a competing one. An owner-verified alias is
 * vouched for by the player's own device and beats every source, so it is
 * ranked by the `ownerVerified` flag rather than here.
 */
const SOURCE_RANK: Readonly<Record<string, number>> = {
  riot_id: 1,
  [RIOT_MATCH_SOURCE]: 2,
};

export function aliasSourceRank(source: string): number {
  return SOURCE_RANK[source] ?? 0;
}

const ClientGameSchema = z.object({
  participants: z.array(
    z.object({
      participantId: z.number(),
      teamId: z.number(),
      championId: z.number(),
    }),
  ),
  participantIdentities: z.array(
    z.object({
      participantId: z.number(),
      player: z.object({
        puuid: z.string(),
        gameName: z.string().optional(),
        tagLine: z.string().optional(),
      }),
    }),
  ),
});

/** The client's post-game payload, with or without its `{ data }` envelope. */
const ClientBundleSchema = z.union([
  z.object({ matchHistory: ClientGameSchema }),
  z.object({ data: z.object({ matchHistory: ClientGameSchema }) }),
]);

export type AliasMapping = {
  readonly lcuUuid: string;
  readonly puuid: LeaguePuuid;
  readonly gameName: string;
  readonly tagLine: string;
};

export type AliasMappingResult = {
  readonly mappings: readonly AliasMapping[];
  /** UUIDs refused because the mapping could not be proven. */
  readonly refused: readonly string[];
};

function teamChampionKey(teamId: number, championId: number): string {
  return `${teamId.toString()}:${championId.toString()}`;
}

function counts(keys: readonly string[]): Map<string, number> {
  const counted = new Map<string, number>();
  for (const key of keys) counted.set(key, (counted.get(key) ?? 0) + 1);
  return counted;
}

/**
 * Map each League-client participant to the Riot participant that is the same
 * seat: same participant id, team and champion. A seat is accepted only when
 * its team and champion pair is unique on both sides — two players on a team
 * sharing a champion (ARAM Mayhem, URF-style modes) would make the match
 * guesswork, so those seats are refused, never guessed.
 */
export function mapClientParticipantsToRiot(
  clientPayload: unknown,
  riotMatch: RawMatch,
): AliasMappingResult {
  const parsed = ClientBundleSchema.safeParse(clientPayload);
  if (!parsed.success) return { mappings: [], refused: [] };
  const game =
    "matchHistory" in parsed.data
      ? parsed.data.matchHistory
      : parsed.data.data.matchHistory;
  const riotSeats = counts(
    riotMatch.info.participants.map((participant) =>
      teamChampionKey(participant.teamId, participant.championId),
    ),
  );
  const clientSeats = counts(
    game.participants.map((participant) =>
      teamChampionKey(participant.teamId, participant.championId),
    ),
  );
  const mappings: AliasMapping[] = [];
  const refused: string[] = [];
  for (const identity of game.participantIdentities) {
    const lcuUuid = identity.player.puuid;
    if (!isLcuUuid(lcuUuid)) continue;
    const seat = game.participants.find(
      (participant) => participant.participantId === identity.participantId,
    );
    if (seat === undefined) continue;
    const key = teamChampionKey(seat.teamId, seat.championId);
    if (riotSeats.get(key) !== 1 || clientSeats.get(key) !== 1) {
      refused.push(lcuUuid);
      continue;
    }
    const riot = riotMatch.info.participants.find(
      (participant) =>
        participant.participantId === identity.participantId &&
        participant.teamId === seat.teamId &&
        participant.championId === seat.championId,
    );
    const puuid = LeaguePuuidSchema.safeParse(riot?.puuid);
    if (riot === undefined || !puuid.success) continue;
    mappings.push({
      lcuUuid,
      puuid: puuid.data,
      gameName: riot.riotIdGameName ?? identity.player.gameName ?? "",
      tagLine: riot.riotIdTagline,
    });
  }
  return { mappings, refused };
}

/** Store one mapping, respecting owner verification and source rank. */
async function storeRiotMatchAlias(mapping: AliasMapping): Promise<boolean> {
  const fields = {
    puuid: mapping.puuid,
    gameName: mapping.gameName,
    tagLine: mapping.tagLine,
    source: RIOT_MATCH_SOURCE,
  };
  const existing = await prisma.leagueIdentityAlias.findUnique({
    where: { lcuUuid: mapping.lcuUuid },
    select: { puuid: true, source: true, ownerVerified: true },
  });
  if (existing === null) {
    const created = await prisma.leagueIdentityAlias.createMany({
      data: [{ lcuUuid: mapping.lcuUuid, ...fields }],
      skipDuplicates: true,
    });
    return created.count === 0 ? storeRiotMatchAlias(mapping) : true;
  }
  if (existing.ownerVerified) return false;
  if (existing.puuid === mapping.puuid) {
    if (aliasSourceRank(existing.source) >= aliasSourceRank(RIOT_MATCH_SOURCE))
      return false;
    await prisma.leagueIdentityAlias.update({
      where: { lcuUuid: mapping.lcuUuid },
      data: { source: RIOT_MATCH_SOURCE },
    });
    return false;
  }
  if (aliasSourceRank(existing.source) >= aliasSourceRank(RIOT_MATCH_SOURCE)) {
    scoutClientIdentityAliasesTotal.inc({ outcome: "conflict" });
    return false;
  }
  await prisma.leagueIdentityAlias.update({
    where: { lcuUuid: mapping.lcuUuid },
    data: { ...fields, resolvedAt: new Date() },
  });
  scoutClientIdentityAliasesTotal.inc({ outcome: "corrected" });
  return true;
}

async function learnFromObservation(
  payload: unknown,
  riotMatch: RawMatch,
  seen: Set<string>,
): Promise<number> {
  const { mappings, refused } = mapClientParticipantsToRiot(payload, riotMatch);
  for (const uuid of refused.filter((refusedUuid) => !seen.has(refusedUuid))) {
    seen.add(uuid);
    scoutClientIdentityAliasesTotal.inc({ outcome: "riot_match_ambiguous" });
    logger.warn(
      `Refused Riot-match alias for ${uuid} in ${riotMatch.metadata.matchId}: team and champion are not unique`,
    );
  }
  let learned = 0;
  for (const mapping of mappings.filter((m) => !seen.has(m.lcuUuid))) {
    seen.add(mapping.lcuUuid);
    if (await storeRiotMatchAlias(mapping)) {
      learned += 1;
      scoutClientIdentityAliasesTotal.inc({ outcome: "riot_match" });
    }
    // Resolved either way: a mapping exists, so a pending lookup is moot.
    await settleAliasAttempt(mapping.lcuUuid);
  }
  return learned;
}

/**
 * Learn aliases at no API cost from a game Riot published and a client also
 * observed. Client-built matches carry no Riot truth and are ignored.
 */
export async function learnAliasesFromRiotMatch(
  riotMatch: RawMatch,
): Promise<number> {
  if (isFeatureHardDisabled("scout_client_ingestion")) return 0;
  if (riotMatch.metadata.dataVersion === SCOUT_CLIENT_DATA_VERSION) return 0;
  const matchId = riotMatch.metadata.matchId;
  const observations = await prisma.scoutClientObservation.findMany({
    where: {
      kind: "post_game",
      gameId: matchId.slice(matchId.indexOf("_") + 1),
      platformId: { equals: platformRouteOf(matchId), mode: "insensitive" },
    },
    select: { payload: true },
  });
  const seen = new Set<string>();
  let learned = 0;
  for (const observation of observations) {
    learned += await learnFromObservation(observation.payload, riotMatch, seen);
  }
  return learned;
}
