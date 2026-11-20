import {
  DiscordAccountIdSchema,
  ExploreTurnRequestSchema,
  type DiscordAccountId,
  type ExploreActiveRun,
  type ExploreRunOutcome,
} from "@scout-for-lol/data";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  LeaguePuuidSchema,
  type LeaguePuuid,
} from "@scout-for-lol/domain/identity/league-account.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type {
  ScoutCoachReviewInput,
  ScoutCoachReviewSettleInput,
  ScoutCoachReviewSkipReason,
  ScoutCoachReviewStartResult,
} from "@scout-for-lol/temporal";
import { REVIEW_TURN_QUESTION } from "#src/coach/app-turns.ts";
import type { CoachTurnRecord } from "#src/coach/audit.ts";
import {
  projectGameContext,
  type CoachPolicyFlags,
} from "#src/coach/context-policy.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("coach-review");

/**
 * The post-game review: one durable Explore turn per owner and finished game,
 * started by the server (`scoutCoachReviewWorkflow`), never by a client.
 *
 * A review exists only for a game the owner recorded. The recording is the
 * proof: it was uploaded by one of the owner's own devices, from a League
 * client signed in to a Riot account the owner has verified, and that account
 * is a participant in the resolved match. The recording itself is post-game
 * data and is not handed to the agent through the live gate; the turn carries
 * only the `postgame` section (the Riot match ID), as `app_postgame`, so it
 * can never carry `live`.
 */

export const REVIEW_KIND = "review";

/** An artifact row as the review reads it. */
export type CoachArtifactRow = {
  readonly ownerId: string;
  readonly matchId: RiotMatchId;
  readonly kind: string;
  readonly status: string;
  readonly runId: string | null;
  readonly conversationId: string | null;
  readonly createdAt: Date;
};

type ArtifactKey = {
  readonly ownerId_matchId_kind: {
    readonly ownerId: DiscordAccountId;
    readonly matchId: RiotMatchId;
    readonly kind: string;
  };
};

/**
 * The database the review touches, as the few calls it makes. Prisma's
 * delegates satisfy it; a test fakes it without Postgres.
 */
export type CoachReviewClient = {
  readonly scoutCoachArtifact: {
    findUnique: (args: {
      where: ArtifactKey;
    }) => Promise<CoachArtifactRow | null>;
    upsert: (args: {
      where: ArtifactKey;
      create: {
        ownerId: DiscordAccountId;
        matchId: RiotMatchId;
        kind: string;
        status: string;
      };
      update: Record<string, never>;
    }) => Promise<unknown>;
    update: (args: {
      where: ArtifactKey;
      data: {
        status?: string;
        runId?: string;
        conversationId?: string;
      };
    }) => Promise<unknown>;
    updateMany: (args: {
      where: {
        ownerId: DiscordAccountId;
        matchId: RiotMatchId;
        kind: string;
        status: string;
      };
      data: { status: string };
    }) => Promise<unknown>;
  };
  readonly scoutCoachTurn: {
    findFirst: (args: {
      where: { ownerId: DiscordAccountId; initiation: string; gameKey: string };
      select: { runId: true; conversationId: true };
    }) => Promise<{ runId: string; conversationId: string } | null>;
  };
  readonly scoutClientObservation: {
    findMany: (args: {
      where: {
        kind: string;
        disposition: string;
        gameId: string;
        platformId: string;
        localPuuid: { not: null };
        device: { ownerId: DiscordAccountId };
      };
      select: { deviceId: true; localPuuid: true };
      orderBy: { capturedAt: "asc" };
    }) => Promise<{ deviceId: string; localPuuid: string | null }[]>;
  };
  readonly riotAccountPreference: {
    findMany: (args: {
      where: { ownerDiscordId: DiscordAccountId; puuid: { in: LeaguePuuid[] } };
      select: { puuid: true };
    }) => Promise<{ puuid: LeaguePuuid }[]>;
  };
};

/** What the review needs from the rest of the backend, replaceable in tests. */
export type CoachReviewDependencies = {
  readonly client: CoachReviewClient;
  /** The owner's Explore-eligible guilds, or null when Explore is closed to them. */
  readonly guildIds: (
    ownerId: DiscordAccountId,
  ) => Promise<readonly DiscordGuildId[] | null>;
  /** `scout_desktop_coach` for this owner. */
  readonly coachEnabled: (
    ownerId: DiscordAccountId,
    guildIds: readonly DiscordGuildId[],
  ) => Promise<boolean>;
  /**
   * The Riot PUUIDs of the resolved match's players, or null while the
   * match's result evidence is unavailable or in conflict.
   */
  readonly matchParticipants: (
    matchId: RiotMatchId,
  ) => Promise<readonly string[] | null>;
  /** `exploreRunManager.start`; throws what it throws. */
  readonly startRun: (
    ownerId: DiscordAccountId,
    request: ReturnType<typeof ExploreTurnRequestSchema.parse>,
    guildIds: readonly DiscordGuildId[],
    coach: CoachTurnRecord,
  ) => Promise<ExploreActiveRun>;
  readonly durableOutcome: (
    runId: string,
    ownerId: DiscordAccountId,
  ) => Promise<ExploreRunOutcome | null>;
  /** True when a start error is Explore refusing on quota or spend. */
  readonly isQuotaRefusal: (error: unknown) => boolean;
};

export function splitMatchId(
  matchId: string,
): { platform: string; gameId: string } | null {
  const [platform, gameId, ...rest] = matchId.split("_");
  return platform === undefined || gameId === undefined || rest.length > 0
    ? null
    : { platform, gameId };
}

type Evidence =
  | { readonly kind: "ready"; readonly deviceId: string }
  | {
      readonly kind: "skipped";
      readonly reason: ScoutCoachReviewSkipReason;
    };

/**
 * The recording this owner uploaded for this game and the resolved match
 * evidence, joined by the owner's verified Riot account.
 */
export async function readReviewEvidence(
  deps: CoachReviewDependencies,
  ownerId: DiscordAccountId,
  matchId: string,
): Promise<Evidence> {
  const parts = splitMatchId(matchId);
  if (parts === null) return { kind: "skipped", reason: "no_recording" };
  const recordings = await deps.client.scoutClientObservation.findMany({
    where: {
      kind: "live_game_recording",
      disposition: "ACCEPTED",
      gameId: parts.gameId,
      platformId: parts.platform,
      localPuuid: { not: null },
      device: { ownerId },
    },
    select: { deviceId: true, localPuuid: true },
    orderBy: { capturedAt: "asc" },
  });
  const owned = await deps.client.riotAccountPreference.findMany({
    where: {
      ownerDiscordId: ownerId,
      puuid: {
        in: recordings.flatMap((row) =>
          row.localPuuid === null
            ? []
            : [LeaguePuuidSchema.parse(row.localPuuid)],
        ),
      },
    },
    select: { puuid: true },
  });
  const ownedPuuids = new Set(owned.map((account) => account.puuid));
  const recording = recordings.find(
    (row) => row.localPuuid !== null && ownedPuuids.has(row.localPuuid),
  );
  const recorded = recording?.localPuuid;
  if (recording === undefined || recorded === null || recorded === undefined) {
    return { kind: "skipped", reason: "no_recording" };
  }
  const participants = await deps.matchParticipants(
    RiotMatchIdSchema.parse(matchId),
  );
  if (participants === null) {
    return { kind: "skipped", reason: "evidence_unresolved" };
  }
  const participated = participants.includes(recorded);
  return participated
    ? { kind: "ready", deviceId: recording.deviceId }
    : { kind: "skipped", reason: "not_a_participant" };
}

type Gate =
  | { readonly ok: true; readonly guildIds: readonly DiscordGuildId[] }
  | {
      readonly ok: false;
      readonly reason: Extract<
        ScoutCoachReviewSkipReason,
        "coach_disabled" | "no_explore_access"
      >;
    };

/** Explore access and `scout_desktop_coach`, as every coach turn is held to. */
async function coachGate(
  deps: CoachReviewDependencies,
  ownerId: DiscordAccountId,
): Promise<Gate> {
  const guildIds = await deps.guildIds(ownerId);
  if (guildIds === null) return { ok: false, reason: "no_explore_access" };
  return (await deps.coachEnabled(ownerId, guildIds))
    ? { ok: true, guildIds }
    : { ok: false, reason: "coach_disabled" };
}

/**
 * Whether a review can be produced for this owner and game right now: the
 * trigger's own check, so a Workflow is started only when both the recording
 * and the match evidence exist. The Workflow checks again.
 */
export async function reviewReady(
  deps: CoachReviewDependencies,
  ownerId: DiscordAccountId,
  matchId: string,
): Promise<boolean> {
  const gate = await coachGate(deps, ownerId);
  if (!gate.ok) return false;
  const evidence = await readReviewEvidence(deps, ownerId, matchId);
  return evidence.kind === "ready";
}

/**
 * Start the review's Explore turn, once. Idempotent across retries and across
 * both triggers: the artifact row (unique per owner, match and kind) is
 * created before the turn, and a turn that started but whose row update was
 * lost is found again by its audit row.
 */
export async function startCoachReview(
  deps: CoachReviewDependencies,
  input: ScoutCoachReviewInput,
): Promise<ScoutCoachReviewStartResult> {
  const ownerId = DiscordAccountIdSchema.parse(input.ownerId);
  const matchId = RiotMatchIdSchema.parse(input.matchId);
  const key = {
    ownerId_matchId_kind: { ownerId, matchId, kind: REVIEW_KIND },
  };
  const existing = await deps.client.scoutCoachArtifact.findUnique({
    where: key,
  });
  if (existing !== null && existing.status !== "pending") {
    return { outcome: "settled", status: terminalStatus(existing.status) };
  }
  if (existing?.runId != null) {
    return { outcome: "started", runId: existing.runId };
  }

  const gate = await coachGate(deps, ownerId);
  if (!gate.ok) return { outcome: "skipped", reason: gate.reason };
  const evidence = await readReviewEvidence(deps, ownerId, input.matchId);
  if (evidence.kind === "skipped") {
    return { outcome: "skipped", reason: evidence.reason };
  }

  await deps.client.scoutCoachArtifact.upsert({
    where: key,
    create: {
      ownerId,
      matchId,
      kind: REVIEW_KIND,
      status: "pending",
    },
    update: {},
  });

  // A turn that started before a crash left its audit row; never start two.
  const earlier = await deps.client.scoutCoachTurn.findFirst({
    where: {
      ownerId,
      initiation: "app_postgame",
      gameKey: input.matchId,
    },
    select: { runId: true, conversationId: true },
  });
  if (earlier !== null) {
    await deps.client.scoutCoachArtifact.update({
      where: key,
      data: { runId: earlier.runId, conversationId: earlier.conversationId },
    });
    return { outcome: "started", runId: earlier.runId };
  }

  const flags: CoachPolicyFlags = {
    coachEnabled: true,
    // A review reads post-game data; live state is never part of it.
    liveAnswersEnabled: false,
  };
  const projected = projectGameContext(
    { postgame: { matchId: input.matchId } },
    { initiation: "app_postgame", flags },
  );
  if (!projected.ok || projected.projection.withheld.length > 0) {
    throw new Error("The post-game review context broke the coach contract");
  }
  try {
    const run = await deps.startRun(
      ownerId,
      ExploreTurnRequestSchema.parse({
        conversationId: null,
        question: REVIEW_TURN_QUESTION,
        attach: { kind: "leaf" },
      }),
      gate.guildIds,
      {
        deviceId: evidence.deviceId,
        initiation: "app_postgame",
        gameKey: input.matchId,
        flags,
        projection: projected.projection,
      },
    );
    await deps.client.scoutCoachArtifact.update({
      where: key,
      data: { runId: run.runId, conversationId: run.conversationId },
    });
    return { outcome: "started", runId: run.runId };
  } catch (error) {
    if (!deps.isQuotaRefusal(error)) throw error;
    logger.info(
      `post-game review for ${input.matchId} declined by Explore's quota`,
    );
    await deps.client.scoutCoachArtifact.update({
      where: key,
      data: { status: "declined" },
    });
    return { outcome: "declined" };
  }
}

function terminalStatus(status: string): "ready" | "declined" | "failed" {
  if (status === "ready" || status === "declined" || status === "failed") {
    return status;
  }
  throw new Error(`Unknown coach artifact status ${status}`);
}

/**
 * Where the review's Explore turn ended, recorded on the artifact. A run
 * still going is `pending` until the Workflow gives up waiting.
 */
export async function settleCoachReview(
  deps: CoachReviewDependencies,
  input: ScoutCoachReviewSettleInput,
): Promise<"pending" | "ready" | "declined" | "failed"> {
  const ownerId = DiscordAccountIdSchema.parse(input.ownerId);
  const matchId = RiotMatchIdSchema.parse(input.matchId);
  const outcome = await deps.durableOutcome(input.runId, ownerId);
  const status =
    outcome === null
      ? input.giveUp
        ? "failed"
        : "pending"
      : outcome === "succeeded"
        ? "ready"
        : "failed";
  if (status !== "pending") {
    // Only a pending row moves; a terminal one is already what it will be.
    await deps.client.scoutCoachArtifact.updateMany({
      where: {
        ownerId,
        matchId,
        kind: REVIEW_KIND,
        status: "pending",
      },
      data: { status },
    });
  }
  return status;
}

/** The artifact a desktop reads: its status and the conversation holding it. */
export async function readCoachReview(
  client: Pick<CoachReviewClient, "scoutCoachArtifact">,
  ownerId: DiscordAccountId,
  matchId: RiotMatchId,
): Promise<{
  readonly matchId: RiotMatchId;
  readonly status: "pending" | "ready" | "declined" | "failed";
  readonly conversationId: string | null;
  readonly createdAt: string;
} | null> {
  const row = await client.scoutCoachArtifact.findUnique({
    where: {
      ownerId_matchId_kind: {
        ownerId,
        matchId,
        kind: REVIEW_KIND,
      },
    },
  });
  if (row === null) return null;
  return {
    matchId: row.matchId,
    status: row.status === "pending" ? "pending" : terminalStatus(row.status),
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
  };
}
