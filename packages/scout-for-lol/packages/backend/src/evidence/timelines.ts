import {
  isArenaQueueOrMode,
  matchDataSourceOf,
  type RawMatch,
  type RawTimeline,
  type PlayerConfigEntry,
} from "@scout-for-lol/data";
import type { ArtifactResolution } from "@scout-for-lol/domain/artifacts/resolution.ts";
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
import { evidenceRecoveryEnabled } from "./admission.ts";
import { optionalSourceRead } from "./source-read.ts";
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
} as const;

/** Resolution, availability and durable capture belong at the artifact boundary. */
export async function resolveMatchTimeline(
  input: TimelineInput,
): Promise<ArtifactResolution<RawTimeline>> {
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
    : await resolveAbsence(input, admission, deadline);
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
  | { kind: "missing" }
  | Extract<ArtifactResolution<RawTimeline>, { kind: "conflict" }>
> {
  const matchId = input.match.metadata.matchId;
  const remainingMs =
    deadline === null
      ? undefined
      : Math.max(0, deadline.getTime() - Date.now());
  const skipRiot =
    isArenaQueueOrMode(input.match.info.queueId, input.match.info.gameMode) ||
    (!evidenceRecoveryEnabled() && input.players.length === 0);
  const [riot, clients] = await Promise.all([
    skipRiot
      ? undefined
      : optionalSourceRead(
          "RIOT",
          () =>
            fetchMatchTimeline(
              matchId,
              platformRouteOf(matchId),
              input.persistence === "best_effort"
                ? "return_undefined"
                : "return_undefined_on_404",
            ),
          remainingMs,
        ),
    optionalSourceRead("SCOUT_CLIENT", () =>
      readClientTimelineCandidates(matchId, input.match),
    ),
  ]);
  if (riot !== undefined) {
    if (!timelineMatchesResult(riot, input.match))
      throw new Error(
        `Riot timeline participant identities disagree with ${matchId}`,
      );
    return { kind: "candidate", value: { timeline: riot, sourceId: matchId } };
  }
  const local = clients ?? [];
  const chosen = local[0];
  if (chosen === undefined) return { kind: "missing" };
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
): Promise<ArtifactResolution<RawTimeline>> {
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
): Promise<ArtifactResolution<RawTimeline>> {
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
  return { kind: "unavailable", reason: "No compatible timeline evidence" };
}

function available(
  value: RawTimeline,
  sourceId: string,
  frozen: boolean,
): ArtifactResolution<RawTimeline> {
  return {
    kind: "available",
    value,
    evidence: [{ source: matchDataSourceOf(value.metadata), sourceId }],
    coverage:
      matchDataSourceOf(value.metadata) === "RIOT" ? "complete" : "partial",
    frozen,
  };
}
