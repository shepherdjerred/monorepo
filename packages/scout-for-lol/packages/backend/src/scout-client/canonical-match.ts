import { ApplicationFailure } from "@temporalio/common";
import {
  RawInfoSchema,
  RawMatchSchema,
  riotWithholdsMatchResult,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import {
  LOCAL_MATCH_TIMING_DRIFT_MS,
  convertLcuMatchBundle,
} from "./canonical/lcu-match.ts";
import { convertLcuTimeline } from "./canonical/lcu-timeline.ts";
import {
  type IdentityMap,
  lcuUuidsIn,
  readIdentityAliases,
  translatePayloadIdentities,
} from "./identity-alias.ts";

export const LOCAL_CANONICAL_DELAY_MS = 2 * 60 * 1000;

type Candidate = {
  readonly observationId: string;
  readonly platformId: string | null;
  readonly localPuuid: string | null;
  readonly payload: unknown;
  readonly bodyDigest: string;
};

const EmbeddedPayloadSchema = z.object({ data: z.unknown() });

function embeddedPayload(payload: unknown): unknown {
  const embedded = EmbeddedPayloadSchema.safeParse(payload);
  return embedded.success ? embedded.data.data : payload;
}

/** A Riot API PUUID: the only player identity a canonical match may carry. */
const RIOT_PUUID_LENGTH = 78;

/**
 * Accept only complete Match-V5-compatible local evidence with identities that
 * agree with both the requested match and verified observer. Complete LCU
 * Match-V5 `info` objects can safely receive their missing metadata wrapper;
 * legacy match-history rows remain partial evidence and are never promoted.
 *
 * The payload names players by League-client UUID and is translated through
 * `identities` first. A match that still names anyone by UUID afterwards is
 * refused: a canonical match is read by everything downstream as Riot data,
 * and an identity from the other namespace would join to nothing at best and
 * to the wrong rows at worst.
 */
export function parseLocalCanonicalMatch(
  riotMatchId: RiotMatchId,
  candidate: Candidate,
  identities: IdentityMap = new Map(),
): RawMatch | null {
  const platform = platformRouteOf(riotMatchId);
  const payload = embeddedPayload(
    translatePayloadIdentities(candidate.payload, identities),
  );
  const localPuuid =
    candidate.localPuuid === null
      ? null
      : (identities.get(candidate.localPuuid) ?? candidate.localPuuid);
  const localBundle = convertLcuMatchBundle(riotMatchId, payload);
  const complete = RawMatchSchema.safeParse(localBundle ?? payload);
  const infoOnly = complete.success ? null : RawInfoSchema.safeParse(payload);
  const infoMatch =
    infoOnly?.success === true
      ? RawMatchSchema.safeParse({
          metadata: {
            dataVersion: "2",
            matchId: riotMatchId,
            participants: infoOnly.data.participants.map(
              (participant) => participant.puuid,
            ),
          },
          info: infoOnly.data,
        })
      : null;
  const match = complete.success
    ? complete.data
    : infoMatch?.success === true
      ? infoMatch.data
      : null;
  if (match === null || localPuuid === null) return null;
  return match.metadata.matchId !== riotMatchId ||
    match.info.platformId.toUpperCase() !== platform ||
    candidate.platformId?.toUpperCase() !== platform ||
    `${platform}_${match.info.gameId.toString()}` !== riotMatchId ||
    !match.metadata.participants.includes(localPuuid) ||
    match.metadata.participants.some(
      (puuid) => puuid.length !== RIOT_PUUID_LENGTH,
    )
    ? null
    : match;
}

/** The aliases a stored candidate needs before it can be parsed. */
async function candidateIdentities(candidate: Candidate): Promise<IdentityMap> {
  const uuids = new Set(lcuUuidsIn(candidate.payload));
  if (candidate.localPuuid !== null) uuids.add(candidate.localPuuid);
  return readIdentityAliases(uuids);
}

/** Read the already-fixed local source without selecting a new one. */
export async function readSelectedLocalCanonicalMatch(
  riotMatchId: RiotMatchId,
): Promise<RawMatch | null> {
  const selected = await prisma.scoutClientCanonicalMatch.findUnique({
    where: { riotMatchId },
    include: { sourceObservation: true },
  });
  if (selected === null) return null;
  const match = parseLocalCanonicalMatch(
    riotMatchId,
    selected.sourceObservation,
    await candidateIdentities(selected.sourceObservation),
  );
  if (match === null) {
    throw ApplicationFailure.nonRetryable(
      `Selected local payload for ${riotMatchId} no longer validates`,
      "ScoutClientCanonicalDrift",
    );
  }
  return match;
}

const TimelineBundleSchema = z.object({
  matchHistory: z.unknown(),
  timeline: z.unknown(),
});

/**
 * Where a match's timeline comes from. A match whose canonical payload is the
 * client's exists because Riot can't see the game, so its timeline comes from
 * the client too: `timeline` is the client's capture in Match-V5 shape, or
 * `null` when the client sent none or it doesn't convert. Asking Riot instead
 * would wait on something that never appears.
 */
export type TimelineSelection =
  | { readonly source: "RIOT" }
  | { readonly source: "SCOUT_CLIENT"; readonly timeline: RawTimeline | null };

export async function readTimelineSelection(
  riotMatchId: RiotMatchId,
): Promise<TimelineSelection> {
  const selected = await prisma.scoutClientCanonicalMatch.findUnique({
    where: { riotMatchId },
    include: { sourceObservation: true },
  });
  if (selected === null) return { source: "RIOT" };
  const bundle = TimelineBundleSchema.safeParse(
    embeddedPayload(selected.sourceObservation.payload),
  );
  if (!bundle.success) return { source: "SCOUT_CLIENT", timeline: null };
  const identities = await candidateIdentities(selected.sourceObservation);
  return {
    source: "SCOUT_CLIENT",
    timeline: convertLcuTimeline(
      riotMatchId,
      translatePayloadIdentities(bundle.data.matchHistory, identities),
      translatePayloadIdentities(bundle.data.timeline, identities),
    ),
  };
}

function conflictingCandidates(riotMatchId: RiotMatchId): never {
  throw ApplicationFailure.nonRetryable(
    `Paired clients supplied conflicting complete payloads for ${riotMatchId}`,
    "ScoutClientObservationConflict",
  );
}

function deterministicMatchJson(match: RawMatch): string {
  return JSON.stringify({
    ...match,
    info: {
      ...match.info,
      gameEndTimestamp: 0,
      gameStartTimestamp: 0,
    },
  });
}

/** Compare local evidence while tolerating bounded observer clock differences. */
export function localCanonicalMatchesAgree(
  first: RawMatch,
  candidate: RawMatch,
): boolean {
  return (
    deterministicMatchJson(first) === deterministicMatchJson(candidate) &&
    Math.abs(
      first.info.gameStartTimestamp - candidate.info.gameStartTimestamp,
    ) <= LOCAL_MATCH_TIMING_DRIFT_MS &&
    Math.abs(first.info.gameEndTimestamp - candidate.info.gameEndTimestamp) <=
      LOCAL_MATCH_TIMING_DRIFT_MS
  );
}

/**
 * Resolve or select an immutable local canonical payload. Selection is
 * allowed only after the observation has been present for two minutes, giving
 * Riot the first opportunity to supply its payload — unless Riot withholds
 * this game's result (a custom, or a queue it never publishes), when the
 * client's payload is used as soon as it arrives.
 */
export async function resolveLocalCanonicalMatch(
  riotMatchId: RiotMatchId,
  now = new Date(),
): Promise<RawMatch | null> {
  const selected = await readSelectedLocalCanonicalMatch(riotMatchId);
  if (selected !== null) return selected;

  const platform = platformRouteOf(riotMatchId);
  const gameId = riotMatchId.slice(riotMatchId.indexOf("_") + 1);
  const cutoff = new Date(now.getTime() - LOCAL_CANONICAL_DELAY_MS);
  const candidates = await prisma.scoutClientObservation.findMany({
    where: {
      kind: "post_game",
      disposition: "ACCEPTED",
      gameId,
      platformId: { equals: platform, mode: "insensitive" },
    },
    orderBy: [{ capturedAt: "asc" }, { observationId: "asc" }],
  });
  const parsed = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      identities: await candidateIdentities(candidate),
    })),
  );
  // Which queue a payload is from is only known once it parses, so the
  // two-minute window is applied here rather than in the query.
  const valid = parsed.flatMap(({ candidate, identities }) => {
    const match = parseLocalCanonicalMatch(riotMatchId, candidate, identities);
    return match === null ||
      (candidate.receivedAt > cutoff && !riotWithholdsMatchResult(match.info))
      ? []
      : [{ candidate, match }];
  });
  if (valid.length === 0) return null;

  const first = valid[0];
  if (first === undefined) return null;
  if (
    valid.some(({ match }) => !localCanonicalMatchesAgree(first.match, match))
  ) {
    conflictingCandidates(riotMatchId);
  }

  const chosen = await prisma.scoutClientCanonicalMatch.upsert({
    where: { riotMatchId },
    create: {
      riotMatchId,
      sourceObservationId: first.candidate.observationId,
      payloadDigest: first.candidate.bodyDigest,
      selectedAt: now,
    },
    update: {},
    include: { sourceObservation: true },
  });
  const resolved = parseLocalCanonicalMatch(
    riotMatchId,
    chosen.sourceObservation,
    await candidateIdentities(chosen.sourceObservation),
  );
  if (resolved === null) conflictingCandidates(riotMatchId);
  return resolved;
}
