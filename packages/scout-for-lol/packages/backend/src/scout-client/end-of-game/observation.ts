import type { EndOfGameMatch } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { convertEndOfGameMatch } from "#src/scout-client/canonical/eog-match.ts";
import {
  type IdentityMap,
  translatePayloadIdentities,
} from "#src/scout-client/identity-alias.ts";

/**
 * Reading the end-of-game canonical record (`local-eog-1`) from stored
 * observations: the `post_game` observation that carries the block alone, and
 * the gameflow session the same device reported before it. Selection lives
 * with the bundle's, in `canonical-match.ts`.
 */

/** What a stored observation must state for its end-of-game reading. */
type EndOfGameCandidate = {
  readonly platformId: string | null;
  readonly localPuuid: string | null;
  readonly payload: unknown;
};

/** A stored `post_game` observation, with what its end-of-game reading needs. */
export type PostGameObservation = EndOfGameCandidate & {
  readonly deviceId: string;
  readonly sequence: bigint;
  readonly gameId: string | null;
};

const PostGameEnvelopeSchema = z.object({
  resource: z.literal("post_game"),
  data: z.unknown(),
});

/** How many gameflow sessions before the block are tried, latest first. */
const GAMEFLOW_CONTEXT_LIMIT = 10;

/**
 * The same device's gameflow sessions for this game that precede the
 * end-of-game block, latest first. A device numbers its observations and
 * uploads them in order, so "before" is by sequence: the answer is fixed once
 * the block is stored, and a re-read after selection reads the same session.
 */
export async function gameflowsBefore(
  observation: PostGameObservation,
): Promise<readonly unknown[]> {
  if (observation.gameId === null || observation.platformId === null) return [];
  const sessions = await prisma.scoutClientObservation.findMany({
    where: {
      deviceId: observation.deviceId,
      kind: "gameflow",
      disposition: "ACCEPTED",
      gameId: observation.gameId,
      platformId: { equals: observation.platformId, mode: "insensitive" },
      sequence: { lt: observation.sequence },
    },
    orderBy: [{ sequence: "desc" }],
    take: GAMEFLOW_CONTEXT_LIMIT,
    select: { payload: true },
  });
  return sessions.map((session) => session.payload);
}

/**
 * The end-of-game canonical record from a `post_game` observation that
 * carries the end-of-game block alone, or `null`. The same identity rules as
 * `parseLocalCanonicalMatch` apply: identities are translated through
 * aliases first, and the observer must be a resolved player in the game. The
 * latest gameflow session that names this game decides its queue and map.
 */
export function parseLocalEndOfGameMatch(
  riotMatchId: RiotMatchId,
  candidate: EndOfGameCandidate,
  gameflows: readonly unknown[],
  identities: IdentityMap = new Map(),
): EndOfGameMatch | null {
  const platform = platformRouteOf(riotMatchId);
  const envelope = PostGameEnvelopeSchema.safeParse(
    translatePayloadIdentities(candidate.payload, identities),
  );
  const localPuuid =
    candidate.localPuuid === null
      ? null
      : (identities.get(candidate.localPuuid) ?? candidate.localPuuid);
  if (
    localPuuid === null ||
    !envelope.success ||
    candidate.platformId?.toUpperCase() !== platform
  )
    return null;
  for (const gameflow of gameflows) {
    const match = convertEndOfGameMatch({
      matchId: riotMatchId,
      endOfGame: envelope.data.data,
      gameflow,
    });
    if (match !== null)
      return match.metadata.participants.includes(localPuuid) ? match : null;
  }
  return null;
}
