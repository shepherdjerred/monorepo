import { ApplicationFailure } from "@temporalio/common";
import {
  RawMatchSchema,
  SCOUT_CLIENT_DATA_VERSION,
  sameStoredIdentity,
  storedParticipantIdentity,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import {
  LOCAL_MATCH_TIMING_DRIFT_MS,
  convertLcuMatchBundle,
} from "./canonical/lcu-match.ts";
import { lcuParticipantIdentity } from "./canonical/lcu-identity.ts";
import { convertLcuTimeline } from "./canonical/lcu-timeline.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedTimelinePayload } from "#src/report-lake/receipted-archive.ts";
import {
  type IdentityMap,
  lcuUuidsIn,
  readIdentityAliases,
  translatePayloadIdentities,
} from "./identity-alias.ts";

import { learnAliasesFromRiotMatch } from "./alias-attempts/riot-match-aliases.ts";
import { clientEvidenceReadyAt } from "#src/evidence/source-grace.ts";

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

const MatchV5WrapperSchema = z.looseObject({
  metadata: z.looseObject({ matchId: z.string() }),
  info: z.unknown(),
});
const MatchV5RosterSchema = z.looseObject({
  participants: z.array(z.looseObject({ puuid: z.string() })),
});

/**
 * A Scout-built match from a Match-V5-shaped client payload, bare `info` or
 * wrapped. Whatever version or kinds the payload claims, it is the client's:
 * each row's kind is decided here from its identity, the metadata is rebuilt
 * to list only the players, and the stored bytes carry the provenance.
 */
function scoutBuiltMatchV5(
  riotMatchId: RiotMatchId,
  payload: unknown,
): RawMatch | null {
  const wrapped = MatchV5WrapperSchema.safeParse(payload);
  if (wrapped.success && wrapped.data.metadata.matchId !== riotMatchId) {
    return null;
  }
  const info = wrapped.success ? wrapped.data.info : payload;
  const roster = MatchV5RosterSchema.safeParse(info);
  if (!roster.success) return null;
  const participants = roster.data.participants.flatMap((participant) => {
    const named = lcuParticipantIdentity(participant.puuid, undefined);
    return named === null
      ? []
      : [{ ...participant, ...storedParticipantIdentity(named) }];
  });
  if (participants.length !== roster.data.participants.length) return null;
  const parsed = RawMatchSchema.safeParse({
    metadata: {
      dataVersion: SCOUT_CLIENT_DATA_VERSION,
      matchId: riotMatchId,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: { ...roster.data, participants },
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Accept only complete Match-V5-compatible local evidence with identities that
 * agree with both the requested match and verified observer. Complete LCU
 * Match-V5 `info` objects can safely receive their missing metadata wrapper;
 * legacy match-history rows remain partial evidence and are never promoted.
 *
 * The payload names players by League-client UUID and is translated through
 * `identities` first. Every row then states its kind: a player by Riot PUUID,
 * a bot, or an unresolved player whose UUID has no alias yet. Only players
 * carry a PUUID, so nothing downstream can join a League-client UUID to Riot
 * data; the observer itself must be a resolved player.
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
  const match =
    convertLcuMatchBundle(riotMatchId, payload) ??
    scoutBuiltMatchV5(riotMatchId, payload);
  if (match === null || localPuuid === null) return null;
  return match.metadata.matchId !== riotMatchId ||
    match.info.platformId.toUpperCase() !== platform ||
    candidate.platformId?.toUpperCase() !== platform ||
    `${platform}_${match.info.gameId.toString()}` !== riotMatchId ||
    !match.metadata.participants.includes(localPuuid)
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
  if (isFeatureHardDisabled("scout_client_ingestion")) return null;
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
  | { readonly source: "ARCHIVED"; readonly timeline: RawTimeline }
  | { readonly source: "RIOT"; readonly clientTimeline?: RawTimeline }
  | { readonly source: "SCOUT_CLIENT"; readonly timeline: RawTimeline | null };

export async function readTimelineSelection(
  riotMatchId: RiotMatchId,
  expectedMatch?: RawMatch,
): Promise<TimelineSelection> {
  const frozen = await readFrozenTimeline(riotMatchId);
  if (frozen !== null) return { source: "ARCHIVED", timeline: frozen };
  if (isFeatureHardDisabled("scout_client_ingestion"))
    return { source: "RIOT" };
  const selected = await prisma.scoutClientCanonicalMatch.findUnique({
    where: { riotMatchId },
    include: { sourceObservation: true },
  });
  const candidates = await readClientTimelineCandidates(
    riotMatchId,
    expectedMatch,
  );
  const timeline = candidates[0]?.timeline;
  return selected === null
    ? {
        source: "RIOT",
        ...(timeline === undefined ? {} : { clientTimeline: timeline }),
      }
    : { source: "SCOUT_CLIENT", timeline: timeline ?? null };
}

/** Timeline candidates are independent of which source supplied the result. */
export async function readClientTimelineCandidates(
  riotMatchId: RiotMatchId,
  expectedMatch?: RawMatch,
) {
  if (isFeatureHardDisabled("scout_client_ingestion")) return [];
  // A Riot-published game teaches the client's participants' aliases for free,
  // and the translation below is the first thing to benefit.
  if (expectedMatch !== undefined)
    await learnAliasesFromRiotMatch(expectedMatch);
  const platform = platformRouteOf(riotMatchId);
  const candidates = await prisma.scoutClientObservation.findMany({
    where: {
      kind: "post_game",
      disposition: "ACCEPTED",
      gameId: riotMatchId.slice(riotMatchId.indexOf("_") + 1),
      platformId: { equals: platform, mode: "insensitive" },
    },
    orderBy: [{ capturedAt: "asc" }, { observationId: "asc" }],
  });
  const timelines: { observationId: string; timeline: RawTimeline }[] = [];
  for (const candidate of candidates) {
    const bundle = TimelineBundleSchema.safeParse(
      embeddedPayload(candidate.payload),
    );
    if (!bundle.success) continue;
    const identities = await candidateIdentities(candidate);
    const timeline = convertLcuTimeline(
      riotMatchId,
      translatePayloadIdentities(bundle.data.matchHistory, identities),
      translatePayloadIdentities(bundle.data.timeline, identities),
    );
    if (timeline === null || !timelineMatchesResult(timeline, expectedMatch))
      continue;
    timelines.push({ observationId: candidate.observationId, timeline });
  }
  return timelines;
}

/** Once used by processing, the archived timeline is immutable across retries. */
export async function readFrozenTimeline(
  riotMatchId: RiotMatchId,
): Promise<RawTimeline | null> {
  const descriptor = await storedRawArchiveDescriptor(
    prisma,
    riotMatchId,
    "timeline",
  );
  return descriptor === null
    ? null
    : await readArchivedTimelinePayload(descriptor, riotMatchId);
}

/**
 * A participant number must identify the same participant in both
 * artifacts: the same kind, and for a player the same PUUID. Two bots share
 * no identity, so their participant number is what pairs them.
 */
export function timelineMatchesResult(
  timeline: RawTimeline,
  match: RawMatch | undefined,
): boolean {
  return (
    match === undefined ||
    (timeline.metadata.matchId === match.metadata.matchId &&
      timeline.info.participants.length === match.info.participants.length &&
      timeline.info.participants.every((participant) =>
        match.info.participants.some(
          (player) =>
            player.participantId === participant.participantId &&
            sameStoredIdentity(player, participant),
        ),
      ))
  );
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
  if (isFeatureHardDisabled("scout_client_ingestion")) return null;
  const selected = await readSelectedLocalCanonicalMatch(riotMatchId);
  if (selected !== null) return selected;

  const candidates = await readLocalCanonicalCandidates(riotMatchId);
  const valid = candidates.filter((entry) => entry.eligibleAt <= now);
  return valid.length === 0
    ? null
    : await selectLocalCanonicalMatch(riotMatchId, valid, now);
}

/** Source adapter: expose compatible candidates without choosing against Riot. */
export async function readLocalCanonicalCandidates(riotMatchId: RiotMatchId) {
  if (isFeatureHardDisabled("scout_client_ingestion")) return [];

  const platform = platformRouteOf(riotMatchId);
  const gameId = riotMatchId.slice(riotMatchId.indexOf("_") + 1);
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
    return match === null
      ? []
      : [
          {
            candidate,
            match,
            eligibleAt: clientEvidenceReadyAt(match.info, candidate.receivedAt),
          },
        ];
  });
  return valid;
}

export async function selectLocalCanonicalMatch(
  riotMatchId: RiotMatchId,
  valid: Awaited<ReturnType<typeof readLocalCanonicalCandidates>>,
  now = new Date(),
): Promise<RawMatch> {
  const first = valid[0];
  if (first === undefined)
    throw new Error("Cannot select an empty candidate set");
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
