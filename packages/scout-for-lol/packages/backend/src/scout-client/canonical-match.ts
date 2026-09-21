import { ApplicationFailure } from "@temporalio/common";
import {
  RawInfoSchema,
  RawMatchSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { convertLcuMatchHistoryRow } from "#src/scout-client/lcu-match.ts";

const LOCAL_CANONICAL_DELAY_MS = 2 * 60 * 1000;

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

/**
 * Accept only complete Match-V5-compatible local evidence with identities that
 * agree with both the requested match and verified observer. Current LCU match
 * history rows carry the complete Match-V5 `info` object without its metadata;
 * derive that identity wrapper from the payload while never inventing gameplay
 * fields for older, partial LCU rows.
 */
export function parseLocalCanonicalMatch(
  riotMatchId: RiotMatchId,
  candidate: Candidate,
): RawMatch | null {
  const platform = platformRouteOf(riotMatchId);
  const payload = embeddedPayload(candidate.payload);
  const complete = RawMatchSchema.safeParse(payload);
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
      : convertLcuMatchHistoryRow(riotMatchId, payload);
  if (match === null) return null;
  if (
    match.metadata.matchId !== riotMatchId ||
    match.info.platformId.toUpperCase() !== platform ||
    candidate.platformId?.toUpperCase() !== platform ||
    `${platform}_${match.info.gameId.toString()}` !== riotMatchId ||
    candidate.localPuuid === null ||
    !match.metadata.participants.includes(candidate.localPuuid)
  ) {
    return null;
  }
  return match;
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
  );
  if (match === null) {
    throw ApplicationFailure.nonRetryable(
      `Selected local payload for ${riotMatchId} no longer validates`,
      "ScoutClientCanonicalDrift",
    );
  }
  return match;
}

function conflictingCandidates(riotMatchId: RiotMatchId): never {
  throw ApplicationFailure.nonRetryable(
    `Paired clients supplied conflicting complete payloads for ${riotMatchId}`,
    "ScoutClientObservationConflict",
  );
}

/**
 * Resolve or select an immutable local canonical payload. Selection is
 * allowed only after the observation has been present for two minutes, giving
 * Riot the first opportunity to supply its payload.
 */
export async function resolveLocalCanonicalMatch(
  riotMatchId: RiotMatchId,
  now = new Date(),
): Promise<RawMatch | null> {
  const selected = await readSelectedLocalCanonicalMatch(riotMatchId);
  if (selected !== null) return selected;

  const gameId = riotMatchId.slice(riotMatchId.indexOf("_") + 1);
  const cutoff = new Date(now.getTime() - LOCAL_CANONICAL_DELAY_MS);
  const candidates = await prisma.scoutClientObservation.findMany({
    where: {
      kind: "post_game",
      disposition: "ACCEPTED",
      gameId,
      receivedAt: { lte: cutoff },
    },
    orderBy: [{ capturedAt: "asc" }, { observationId: "asc" }],
    take: 32,
  });
  const valid = candidates.flatMap((candidate) => {
    const match = parseLocalCanonicalMatch(riotMatchId, candidate);
    return match === null ? [] : [{ candidate, match }];
  });
  if (valid.length === 0) return null;

  const first = valid[0];
  if (first === undefined) return null;
  const canonical = JSON.stringify(first.match);
  if (valid.some(({ match }) => JSON.stringify(match) !== canonical)) {
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
  );
  if (resolved === null) conflictingCandidates(riotMatchId);
  return resolved;
}
