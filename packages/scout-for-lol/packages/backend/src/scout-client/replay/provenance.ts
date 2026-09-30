import { z } from "zod";
import type { RawMatch } from "@scout-for-lol/data";
import type {
  ReplayParticipantFingerprint,
  ReplayProvenance,
} from "./container.ts";

const GameIdSchema = z.string().regex(/^\d{1,32}$/);
const MatchStatsSchema = z.looseObject({
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  goldEarned: z.number().int().nonnegative(),
  goldSpent: z.number().int().nonnegative(),
  totalDamageDealtToChampions: z.number().int().nonnegative(),
  totalMinionsKilled: z.number().int().nonnegative(),
  visionScore: z.number().int().nonnegative(),
  wardsPlaced: z.number().int().nonnegative(),
  wardsKilled: z.number().int().nonnegative(),
  champLevel: z.number().int().nonnegative(),
  win: z.union([z.boolean(), z.enum(["Win", "Fail"])]),
  item0: z.number().int().nonnegative(),
  item1: z.number().int().nonnegative(),
  item2: z.number().int().nonnegative(),
  item3: z.number().int().nonnegative(),
  item4: z.number().int().nonnegative(),
  item5: z.number().int().nonnegative(),
  item6: z.number().int().nonnegative(),
});
const MatchParticipantSchema = z.looseObject({
  participantId: z.number().int().positive(),
  teamId: z.number().int().positive(),
  stats: MatchStatsSchema,
});
const MatchIdentitySchema = z.looseObject({
  participantId: z.number().int().positive(),
  player: z.looseObject({ puuid: z.string().min(1) }),
});
const MatchHistoryEvidenceSchema = z.looseObject({
  gameId: z
    .union([z.number().int().positive(), GameIdSchema])
    .transform(String),
  gameDuration: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60),
  participantIdentities: z.array(MatchIdentitySchema).min(1).max(20),
  participants: z.array(MatchParticipantSchema).min(1).max(20),
});
const PostGamePayloadSchema = z.looseObject({ data: z.unknown() });
const PostGameBundleSchema = z.looseObject({
  matchHistory: MatchHistoryEvidenceSchema,
});

function participantFingerprint(
  match: z.infer<typeof MatchHistoryEvidenceSchema>,
  localPuuid: string,
): ReplayParticipantFingerprint | null {
  const identity = match.participantIdentities.find(
    (candidate) => candidate.player.puuid === localPuuid,
  );
  if (identity === undefined) return null;
  const participant = match.participants.find(
    (candidate) => candidate.participantId === identity.participantId,
  );
  if (participant === undefined) return null;
  const stats = participant.stats;
  return {
    puuid: identity.player.puuid,
    teamId: participant.teamId,
    kills: stats.kills,
    deaths: stats.deaths,
    assists: stats.assists,
    goldEarned: stats.goldEarned,
    goldSpent: stats.goldSpent,
    totalDamageDealtToChampions: stats.totalDamageDealtToChampions,
    totalMinionsKilled: stats.totalMinionsKilled,
    visionScore: stats.visionScore,
    wardsPlaced: stats.wardsPlaced,
    wardsKilled: stats.wardsKilled,
    championLevel: stats.champLevel,
    win: stats.win === true || stats.win === "Win" ? "Win" : "Fail",
    items: [
      stats.item0,
      stats.item1,
      stats.item2,
      stats.item3,
      stats.item4,
      stats.item5,
      stats.item6,
    ],
  };
}

/**
 * The same fingerprint, taken from a canonical Match-V5 payload.
 *
 * A replay is worth keeping whenever anyone can vouch for the game, not only
 * when the uploading device happened to witness it. The server already holds
 * an authoritative payload for most games — archived from Riot, or promoted
 * from another paired client — and it carries every field the container check
 * compares against. Reading it here is what lets a device offer a replay for a
 * game it played before it was ever paired.
 *
 * `uploaderPuuids` is the set of accounts the offering owner has registered.
 * The uploader must be one of the ten, because the container binds the file to
 * that player's exact stat line; a game none of the owner's accounts played is
 * not theirs to hand over.
 */
export function replayProvenanceFromMatch(
  match: RawMatch,
  uploaderPuuids: readonly string[],
): ReplayProvenance | null {
  const owned = new Set(uploaderPuuids);
  const participant = match.info.participants.find((candidate) =>
    owned.has(candidate.puuid),
  );
  if (participant === undefined) return null;
  return {
    localPuuid: participant.puuid,
    leaguePatch: match.info.gameVersion,
    gameDurationSeconds: match.info.gameDuration,
    participant: {
      puuid: participant.puuid,
      teamId: participant.teamId,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      goldEarned: participant.goldEarned,
      goldSpent: participant.goldSpent,
      totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
      totalMinionsKilled: participant.totalMinionsKilled,
      visionScore: participant.visionScore,
      wardsPlaced: participant.wardsPlaced,
      wardsKilled: participant.wardsKilled,
      championLevel: participant.champLevel,
      // Riot answers with a boolean where the replay container spells it out.
      win: participant.win ? "Win" : "Fail",
      items: [
        participant.item0,
        participant.item1,
        participant.item2,
        participant.item3,
        participant.item4,
        participant.item5,
        participant.item6,
      ],
    },
  };
}

type ObservedReplayEvidence = {
  readonly payload: unknown;
  readonly localPuuid: string;
  readonly leaguePatch: string | null;
  readonly requestedGameId: string;
};

/** Bind one requested game to its observer's exact post-game stat fingerprint. */
export function parseObservedReplayProvenance(
  evidence: ObservedReplayEvidence,
): ReplayProvenance | null {
  const envelope = PostGamePayloadSchema.safeParse(evidence.payload);
  if (!envelope.success) return null;
  const direct = MatchHistoryEvidenceSchema.safeParse(envelope.data.data);
  const bundle = PostGameBundleSchema.safeParse(envelope.data.data);
  const matchHistory = direct.success
    ? direct.data
    : bundle.success
      ? bundle.data.matchHistory
      : null;
  if (matchHistory?.gameId !== evidence.requestedGameId) return null;
  const participant = participantFingerprint(matchHistory, evidence.localPuuid);
  if (participant === null) return null;
  return {
    localPuuid: evidence.localPuuid,
    leaguePatch: evidence.leaguePatch,
    gameDurationSeconds: matchHistory.gameDuration,
    participant,
  };
}
