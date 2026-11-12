import type { AccountRegionalRoute } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { scoutClientIdentityAliasesTotal } from "#src/metrics/scout-client.ts";
import {
  accountRouteFor,
  lookUpRiotId,
  storeAlias,
  type LcuIdentity,
  type LookupErrorClass,
} from "#src/scout-client/identity-alias.ts";

const logger = createLogger("scout-client-identity-attempts");

export type AliasAttemptState =
  "pending" | "resolved" | "not_found" | "no_riot_id";

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 6 * 60 * 60_000;
/** Attempts made per reconciliation run; the run repeats every minute. */
export const ALIAS_ATTEMPT_BATCH = 25;
/** Observation ids kept per UUID; the oldest are dropped past this. */
const MAX_OBSERVATION_IDS = 200;

/** Capped exponential delay before the attempt that follows `attempts` tries. */
export function aliasBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts), BACKOFF_CAP_MS);
}

type LookupOutcome =
  | { readonly kind: "found" }
  | { readonly kind: "not_found" }
  | { readonly kind: "error"; readonly errorClass: LookupErrorClass };

/**
 * What a lookup outcome does to an attempt. Pure, so the transitions are
 * testable without a database.
 */
export function nextAttemptState(
  current: { readonly attempts: number },
  outcome: LookupOutcome,
  now: Date,
): {
  readonly state: AliasAttemptState;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly lastErrorClass: string | null;
} {
  const attempts = current.attempts + 1;
  switch (outcome.kind) {
    case "found":
      return {
        state: "resolved",
        attempts,
        nextAttemptAt: now,
        lastErrorClass: null,
      };
    case "not_found":
      return {
        state: "not_found",
        attempts,
        nextAttemptAt: now,
        lastErrorClass: null,
      };
    case "error":
      return {
        state: "pending",
        attempts,
        nextAttemptAt: new Date(
          now.getTime() + aliasBackoffMs(current.attempts),
        ),
        lastErrorClass: outcome.errorClass,
      };
  }
}

export type AttemptCandidate = {
  readonly lcuUuid: string;
  /** Null or empty when the client reported the player with no Riot ID. */
  readonly gameName: string | null;
  readonly tagLine: string | null;
  readonly platformId: string | undefined;
  readonly observationId: string;
};

function sameRiotId(
  row: { gameName: string | null; tagLine: string | null },
  candidate: AttemptCandidate,
): boolean {
  return (
    (row.gameName ?? "").toLowerCase() ===
      (candidate.gameName ?? "").toLowerCase() &&
    (row.tagLine ?? "").toLowerCase() ===
      (candidate.tagLine ?? "").toLowerCase()
  );
}

function isBlankRiotId(candidate: AttemptCandidate): boolean {
  return (candidate.gameName ?? "") === "" || (candidate.tagLine ?? "") === "";
}

function groupByUuid(
  candidates: readonly AttemptCandidate[],
): Map<string, AttemptCandidate[]> {
  const byUuid = new Map<string, AttemptCandidate[]>();
  for (const candidate of candidates) {
    byUuid.set(candidate.lcuUuid, [
      ...(byUuid.get(candidate.lcuUuid) ?? []),
      candidate,
    ]);
  }
  return byUuid;
}

async function aliasedUuids(uuids: readonly string[]): Promise<Set<string>> {
  const rows = await prisma.leagueIdentityAlias.findMany({
    where: { lcuUuid: { in: [...uuids] } },
    select: { lcuUuid: true },
  });
  return new Set(rows.map((row) => row.lcuUuid));
}

async function existingAttempts(uuids: readonly string[]) {
  const rows = await prisma.leagueIdentityAliasAttempt.findMany({
    where: { lcuUuid: { in: [...uuids] } },
  });
  return new Map(rows.map((row) => [row.lcuUuid, row]));
}

async function insertAttempt({
  lcuUuid,
  named,
  latest,
  deviceId,
  now,
}: {
  lcuUuid: string;
  named: readonly AttemptCandidate[];
  latest: AttemptCandidate;
  deviceId: string;
  now: Date;
}): Promise<void> {
  const state: AliasAttemptState = isBlankRiotId(latest)
    ? "no_riot_id"
    : "pending";
  await prisma.leagueIdentityAliasAttempt.createMany({
    data: [
      {
        lcuUuid,
        state,
        gameName: latest.gameName,
        tagLine: latest.tagLine,
        platformId: latest.platformId ?? null,
        learnedFromDeviceId: deviceId,
        nextAttemptAt: now,
        observationIds: named.map((item) => item.observationId),
      },
    ],
    skipDuplicates: true,
  });
  scoutClientIdentityAliasesTotal.inc({
    outcome: state === "pending" ? "queued" : "no_riot_id",
  });
}

async function amendAttempt(
  row: {
    lcuUuid: string;
    state: string;
    gameName: string | null;
    tagLine: string | null;
    observationIds: string[];
  },
  named: readonly AttemptCandidate[],
  latest: AttemptCandidate,
  now: Date,
): Promise<void> {
  const merged = [
    ...new Set([...row.observationIds, ...named.map((n) => n.observationId)]),
  ].slice(-MAX_OBSERVATION_IDS);
  // A settled attempt reopens only when the client now reports a different
  // Riot ID; the same one would answer the same way.
  const reopen =
    row.state !== "pending" &&
    row.state !== "resolved" &&
    !isBlankRiotId(latest) &&
    !sameRiotId(row, latest);
  await prisma.leagueIdentityAliasAttempt.update({
    where: { lcuUuid: row.lcuUuid },
    data: {
      observationIds: merged,
      ...(reopen
        ? {
            state: "pending",
            gameName: latest.gameName,
            tagLine: latest.tagLine,
            platformId: latest.platformId ?? null,
            attempts: 0,
            nextAttemptAt: now,
            lastErrorClass: null,
          }
        : {}),
    },
  });
  if (reopen) scoutClientIdentityAliasesTotal.inc({ outcome: "queued" });
}

/**
 * Record, without calling Riot, that these UUIDs need translating. UUIDs that
 * already have an alias are skipped; a blank Riot ID is recorded as
 * `no_riot_id` rather than dropped. An existing attempt only gains the naming
 * observation, unless the Riot ID changed, which reopens it.
 */
export async function enqueueAliasAttempts(
  candidates: readonly AttemptCandidate[],
  deviceId: string,
  now = new Date(),
): Promise<void> {
  if (candidates.length === 0) return;
  const byUuid = groupByUuid(candidates);
  const uuids = [...byUuid.keys()];
  const aliased = await aliasedUuids(uuids);
  const existing = await existingAttempts(uuids);
  for (const [lcuUuid, named] of byUuid) {
    const latest = named.at(-1);
    if (latest === undefined || aliased.has(lcuUuid)) continue;
    const row = existing.get(lcuUuid);
    await (row === undefined
      ? insertAttempt({ lcuUuid, named, latest, deviceId, now })
      : amendAttempt(row, named, latest, now));
  }
}

/**
 * Hand the observations that named a UUID back to client-evidence recovery.
 * The checkpoint goes back to the epoch rather than null because the recovery
 * page selects on `recoveryAttemptAt < cutoff`, which a null never satisfies.
 */
export async function requeueObservationsFor(
  observationIds: readonly string[],
): Promise<number> {
  if (observationIds.length === 0) return 0;
  const result = await prisma.scoutClientObservation.updateMany({
    where: {
      observationId: { in: [...observationIds] },
      kind: { in: ["post_game", "clash"] },
    },
    data: { recoveryComplete: false, recoveryAttemptAt: new Date(0) },
  });
  return result.count;
}

/** Mark an attempt resolved (a stored mapping now exists) and re-queue what it blocked. */
export async function settleAliasAttempt(lcuUuid: string): Promise<void> {
  const row = await prisma.leagueIdentityAliasAttempt.findUnique({
    where: { lcuUuid },
    select: { observationIds: true, state: true },
  });
  if (row === null) return;
  await requeueObservationsFor(row.observationIds);
  if (row.state !== "resolved") {
    await prisma.leagueIdentityAliasAttempt.update({
      where: { lcuUuid },
      data: { state: "resolved", lastErrorClass: null },
    });
  }
}

async function ownedPuuids(deviceId: string | null): Promise<Set<string>> {
  if (deviceId === null) return new Set();
  const device = await prisma.scoutClientDevice.findUnique({
    where: { id: deviceId },
    select: { ownerId: true },
  });
  if (device === null) return new Set();
  const owned = await prisma.account.findMany({
    where: { player: { discordId: device.ownerId } },
    select: { puuid: true },
  });
  return new Set(owned.map((account) => account.puuid));
}

/**
 * Work through the attempts that are due: a bounded, oldest-first batch.
 * Rate limiting ends the batch, since every further call would be refused too.
 * Returns how many lookups were made.
 */
export async function drainAliasAttempts(
  now = new Date(),
  limit = ALIAS_ATTEMPT_BATCH,
): Promise<number> {
  const due = await prisma.leagueIdentityAliasAttempt.findMany({
    where: { state: "pending", nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { lcuUuid: "asc" }],
    take: limit,
  });
  let made = 0;
  for (const attempt of due) {
    if (attempt.gameName === null || attempt.tagLine === null) {
      await prisma.leagueIdentityAliasAttempt.update({
        where: { lcuUuid: attempt.lcuUuid },
        data: { state: "no_riot_id" },
      });
      continue;
    }
    const identity: LcuIdentity = {
      lcuUuid: attempt.lcuUuid,
      gameName: attempt.gameName,
      tagLine: attempt.tagLine,
    };
    const route: AccountRegionalRoute = accountRouteFor(attempt.platformId);
    const outcome = await lookUpRiotId(identity, route);
    made += 1;
    const next = nextAttemptState(attempt, outcome, now);
    if (outcome.kind === "found") {
      await storeAlias(identity, outcome.puuid, {
        route,
        learnedFromDeviceId: attempt.learnedFromDeviceId ?? "alias-attempt",
        ownedPuuids: await ownedPuuids(attempt.learnedFromDeviceId),
        observerUuids: new Set(),
      });
    }
    await prisma.leagueIdentityAliasAttempt.update({
      where: { lcuUuid: attempt.lcuUuid },
      data: next,
    });
    if (outcome.kind === "found") {
      await requeueObservationsFor(attempt.observationIds);
      continue;
    }
    if (outcome.kind === "error") {
      scoutClientIdentityAliasesTotal.inc({ outcome: "retry_scheduled" });
      if (outcome.errorClass === "rate_limited") {
        logger.warn("Alias attempt drain stopping: Riot rate limited");
        break;
      }
    }
  }
  return made;
}
