import {
  isArenaQueueOrMode,
  matchDataSourceOf,
  type RawMatch,
  type RawTimeline,
  type PlayerConfigEntry,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { TIMELINE_RECOVERY_WINDOW_MS } from "@scout-for-lol/domain/match-processing/eligibility.ts";
import { prisma } from "#src/database/index.ts";
import { fetchMatchTimeline } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import {
  readClientTimelineCandidates,
  readFrozenTimeline,
  timelineMatchesResult,
} from "#src/scout-client/canonical-match.ts";
import { recordTimelineForReportStore } from "#src/report-store/live-ingest.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { evidenceRecoveryEnabled } from "./recovery-gate.ts";
import {
  expectedRiotAbsenceStatuses,
  isExpectedSourceReadError,
  readSource,
  riotAbsenceOf,
  type EvidenceResolution,
} from "./source-read.ts";
import type { RiotSourceAbsence } from "#src/league/api/client/errors.ts";
import * as Sentry from "@sentry/bun";

export type TimelinePersistence =
  "best_effort" | "required" | "required_if_available";
type TimelineInput = {
  match: RawMatch;
  players: readonly PlayerConfigEntry[];
  persistence: TimelinePersistence;
  purpose?: "processing" | "history";
};
type TimelineAdmission = {
  policy: string;
  timelineDeadlineAt: Date | null;
  timelineFinalizedAt: Date | null;
  timelineMissing: boolean;
};
type TimelineCandidate = { timeline: RawTimeline; sourceId: string };
const PINNED_MISSING = {
  kind: "unavailable",
  reason: "Processing pinned missing timeline coverage",
  definitiveAbsence: undefined,
} as const;

/** Resolution, availability and durable capture belong at the artifact boundary. */
export async function resolveMatchTimeline(
  input: TimelineInput,
): Promise<EvidenceResolution<RawTimeline>> {
  const matchId = input.match.metadata.matchId;
  const admission =
    input.purpose !== "history" && evidenceRecoveryEnabled()
      ? await prisma.matchEvidenceAdmission.findUnique({
          where: { riotMatchId: matchId },
        })
      : null;
  if (admission?.timelineMissing === true) return PINNED_MISSING;
  const frozen = await readFrozenTimeline(matchId);
  if (frozen !== null)
    return input.persistence === "best_effort"
      ? available(frozen, matchId, true)
      : await persistTimeline(
          input,
          { timeline: frozen, sourceId: matchId },
          admission,
        );
  const deadline = await processingDeadline(matchId, admission);
  const candidate = await acquireTimeline(input, deadline);
  if (candidate.kind === "conflict") return candidate;
  return candidate.kind === "candidate"
    ? await persistTimeline(input, candidate.value, admission)
    : await resolveAbsence(input, admission, deadline, candidate.riotAbsence);
}

/**
 * Pin a game's timeline coverage as missing, for a game that can never have
 * one: a game frozen as an end-of-game record. The same durable decision a
 * passed deadline writes, so every reader (`timelineMissing`, Dare timeline
 * waits, history recovery) treats it alike. A decision already made stands.
 */
export async function pinMissingTimeline(matchId: RiotMatchId): Promise<void> {
  await prisma.matchEvidenceAdmission.updateMany({
    where: { riotMatchId: matchId, timelineFinalizedAt: null },
    data: { timelineFinalizedAt: new Date(), timelineMissing: true },
  });
}

async function processingDeadline(
  matchId: RiotMatchId,
  admission: TimelineAdmission | null,
): Promise<Date | null> {
  if (admission === null) return null;
  if (
    admission.policy !== "FULL" ||
    admission.timelineFinalizedAt !== null ||
    admission.timelineDeadlineAt !== null
  )
    return admission.timelineDeadlineAt;
  await prisma.matchEvidenceAdmission.updateMany({
    where: { riotMatchId: matchId, timelineDeadlineAt: null },
    data: {
      timelineDeadlineAt: new Date(Date.now() + TIMELINE_RECOVERY_WINDOW_MS),
    },
  });
  const stored = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: matchId },
  });
  return stored.timelineDeadlineAt;
}

async function acquireTimeline(
  input: TimelineInput,
  deadline: Date | null,
): Promise<
  | { kind: "candidate"; value: TimelineCandidate }
  | { kind: "missing"; riotAbsence: RiotSourceAbsence | undefined }
  | Extract<EvidenceResolution<RawTimeline>, { kind: "conflict" }>
> {
  const matchId = input.match.metadata.matchId;
  const remainingMs =
    deadline === null
      ? undefined
      : Math.max(0, deadline.getTime() - Date.now());
  const skipRiot =
    isArenaQueueOrMode(input.match.info.queueId, input.match.info.gameMode) ||
    (!evidenceRecoveryEnabled() && input.players.length === 0);
  const bestEffort = input.persistence === "best_effort";
  const [riotRead, clientRead] = await Promise.allSettled([
    skipRiot
      ? undefined
      : readSource(
          "RIOT",
          () =>
            fetchMatchTimeline(
              matchId,
              platformRouteOf(matchId),
              bestEffort ? "return_undefined" : "return_undefined_on_404",
              { expectedAbsenceStatuses: expectedRiotAbsenceStatuses() },
            ),
          remainingMs,
        ),
    readClientTimelineCandidates(matchId, input.match),
  ]);
  if (riotRead.status === "rejected") throw riotRead.reason;
  if (
    clientRead.status === "rejected" &&
    !isExpectedSourceReadError(clientRead.reason)
  )
    throw clientRead.reason;
  const riot =
    riotRead.value?.kind === "read" ? riotRead.value.value : undefined;
  if (riot !== undefined) {
    if (!timelineMatchesResult(riot, input.match))
      throw new Error(
        `Riot timeline participant identities disagree with ${matchId}`,
      );
    return { kind: "candidate", value: { timeline: riot, sourceId: matchId } };
  }
  // A successful Riot read can stand alone; absence requires a successful durable read.
  if (clientRead.status === "rejected") throw clientRead.reason;
  const local = clientRead.value;
  const chosen = local[0];
  if (chosen === undefined)
    return {
      kind: "missing",
      // A skipped read, or a best-effort one that folds every failure into
      // `undefined`, says nothing definitive about Riot's copy.
      riotAbsence:
        bestEffort || riotRead.value === undefined
          ? undefined
          : riotAbsenceOf(riotRead.value),
    };
  if (
    local.some(
      (candidate) =>
        JSON.stringify(candidate.timeline) !== JSON.stringify(chosen.timeline),
    )
  )
    return {
      kind: "conflict",
      evidence: local.map((candidate) => ({
        source: "SCOUT_CLIENT",
        sourceId: candidate.observationId,
      })),
    };
  return {
    kind: "candidate",
    value: { timeline: chosen.timeline, sourceId: chosen.observationId },
  };
}

async function persistTimeline(
  input: TimelineInput,
  candidate: TimelineCandidate,
  admission: TimelineAdmission | null,
): Promise<EvidenceResolution<RawTimeline>> {
  const matchId = input.match.metadata.matchId;
  const staged = await stageTimeline(input, candidate.timeline);
  if (!staged && input.persistence !== "best_effort")
    throw new Error(`Timeline persistence failed for ${matchId}`);
  if (admission !== null && staged) {
    await prisma.matchEvidenceAdmission.updateMany({
      where: { riotMatchId: matchId, timelineFinalizedAt: null },
      data: { timelineFinalizedAt: new Date() },
    });
    const decision = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
      where: { riotMatchId: matchId },
    });
    if (decision.timelineMissing) return PINNED_MISSING;
  }
  const pinned = await readFrozenTimeline(matchId);
  return available(
    pinned ?? candidate.timeline,
    candidate.sourceId,
    pinned !== null,
  );
}

async function stageTimeline(
  input: TimelineInput,
  timeline: RawTimeline,
): Promise<boolean> {
  try {
    return await recordTimelineForReportStore({
      timeline,
      source: "timeline_live",
      trackedPlayerAliases: input.players.map((player) => player.alias),
      gameCreatedAt: new Date(input.match.info.gameCreation),
    });
  } catch (error) {
    if (input.persistence !== "best_effort") throw error;
    Sentry.captureException(error, {
      tags: { source: "optional-timeline-persistence" },
    });
    return false;
  }
}

async function resolveAbsence(
  input: TimelineInput,
  admission: TimelineAdmission | null,
  deadline: Date | null,
  riotAbsence: RiotSourceAbsence | undefined,
): Promise<EvidenceResolution<RawTimeline>> {
  const matchId = input.match.metadata.matchId;
  if (deadline !== null && deadline.getTime() > Date.now())
    return { kind: "pending", retryAt: deadline.toISOString() };
  if (admission !== null) {
    await prisma.matchEvidenceAdmission.updateMany({
      where: { riotMatchId: matchId, timelineFinalizedAt: null },
      data: { timelineFinalizedAt: new Date(), timelineMissing: true },
    });
    const decision = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
      where: { riotMatchId: matchId },
    });
    if (!decision.timelineMissing && decision.timelineFinalizedAt !== null) {
      const pinned = await readFrozenTimeline(matchId);
      if (pinned === null)
        throw new Error(`Available timeline for ${matchId} has no archive`);
      return available(pinned, matchId, true);
    }
  }
  if (!evidenceRecoveryEnabled() && input.persistence === "required")
    throw new Error(
      `Timeline lake staging failed for ${matchId}; match processing must retry.`,
    );
  return {
    kind: "unavailable",
    reason: "No compatible timeline evidence",
    definitiveAbsence: riotAbsence,
  };
}

function available(
  value: RawTimeline,
  sourceId: string,
  frozen: boolean,
): EvidenceResolution<RawTimeline> {
  return {
    kind: "available",
    value,
    evidence: [{ source: matchDataSourceOf(value.metadata), sourceId }],
    coverage:
      matchDataSourceOf(value.metadata) === "RIOT" ? "complete" : "partial",
    frozen,
  };
}
