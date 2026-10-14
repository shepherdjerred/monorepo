import { z } from "zod";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { MatchDeliveryMode } from "@scout-for-lol/domain/match-processing/states.ts";
import { processingEligibility } from "@scout-for-lol/domain/match-processing/eligibility.ts";
import { prisma } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";

const PolicySchema = z.enum(["FULL", "HISTORY_ONLY"]);
type AdmissionInput = {
  matchId: RiotMatchId;
  completedAt: number | null;
  historical: boolean;
  discoveredAt?: Date;
  riotHistoryListed?: boolean;
};

function firstDiscoveryEligibility(input: AdmissionInput, now: Date) {
  if (input.completedAt !== null)
    return processingEligibility({
      historical: input.historical,
      completedAt: input.completedAt,
      discoveredAt: now.getTime(),
    });
  if (!input.historical)
    throw new Error("A new live admission requires a completion timestamp");
  return { policy: "HISTORY_ONLY", reason: "history-discovery" } as const;
}

function legacyEligibility(
  legacy: { deliveryMode: string; processingPolicy: string } | null,
) {
  if (
    legacy?.deliveryMode === "silent-backfill" ||
    legacy?.processingPolicy === "HISTORY_ONLY"
  )
    return { policy: "HISTORY_ONLY", reason: "legacy-history" } as const;
  return legacy?.processingPolicy === "FULL"
    ? ({ policy: "FULL", reason: "legacy-live" } as const)
    : null;
}

/** One rollout boundary. Production retains its existing Riot processing contract. */
export function evidenceRecoveryEnabled(): boolean {
  return !isFeatureHardDisabled("scout_client_ingestion");
}

/** Later history evidence does not change a previously admitted live decision. */
export function admittedDeliveryMode(
  policy: "FULL" | "HISTORY_ONLY",
  legacy: MatchDeliveryMode,
): MatchDeliveryMode {
  if (!evidenceRecoveryEnabled()) return legacy;
  return policy === "FULL" ? "live" : "silent-backfill";
}

/** Admission is source-independent and write-once, before any source grace period. */
export async function admitMatchEvidence(
  input: AdmissionInput,
): Promise<"FULL" | "HISTORY_ONLY"> {
  if (!evidenceRecoveryEnabled()) return "FULL";
  const now = input.discoveredAt ?? new Date();
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`match-admission:${input.matchId}`}, 0))`;
    const legacy = await tx.matchObservation.findUnique({
      where: { riotMatchId: input.matchId },
    });
    // Existing live processing keeps its decision. Historical FULL rows were a
    // producer bug: preserve the old policy/promotion as audit data and block
    // future effects without reversing any receipts, ledger entries or progress.
    const decision =
      legacyEligibility(legacy) ?? firstDiscoveryEligibility(input, now);
    const admission = await tx.matchEvidenceAdmission.upsert({
      where: { riotMatchId: input.matchId },
      create: {
        riotMatchId: input.matchId,
        policy: decision.policy,
        reason: decision.reason,
        firstDiscoveredAt: legacy?.observedAt ?? now,
        completedAt:
          input.completedAt === null ? null : new Date(input.completedAt),
        riotHistoryListed: input.riotHistoryListed ?? false,
        legacyPolicy: legacy?.processingPolicy ?? null,
        legacyPromotedAt: legacy?.promotedAt ?? null,
      },
      update:
        input.riotHistoryListed === true ? { riotHistoryListed: true } : {},
    });
    const policy = PolicySchema.parse(admission.policy);
    if (
      policy === "HISTORY_ONLY" &&
      legacy?.pipelineOwner === "TEMPORAL_V2" &&
      legacy.processingPolicy === "FULL"
    ) {
      await tx.matchObservation.update({
        where: { riotMatchId: input.matchId },
        data: { processingPolicy: "HISTORY_ONLY", promotedAt: null },
      });
    }
    return policy;
  });
}

/** Guard Activities as well as orchestration: old histories can still call them. */
export async function matchEffectsAllowed(
  matchId: RiotMatchId,
): Promise<boolean> {
  if (!evidenceRecoveryEnabled()) return true;
  const [admission, observation] = await Promise.all([
    prisma.matchEvidenceAdmission.findUnique({
      where: { riotMatchId: matchId },
    }),
    prisma.matchObservation.findUnique({ where: { riotMatchId: matchId } }),
  ]);
  if (admission !== null)
    return PolicySchema.parse(admission.policy) === "FULL";
  if (observation === null)
    throw new Error(`Effect attempted before admission for ${matchId}`);
  if (observation.processingPolicy !== "FULL") return false;
  return (
    (await admitMatchEvidence({
      matchId,
      completedAt: null,
      historical: observation.deliveryMode === "silent-backfill",
      discoveredAt: observation.observedAt,
    })) === "FULL"
  );
}

/** Shared allowlist for aggregate effect readers; history stays in the analytical lake. */
export async function effectEligibleMatchIds(
  matchIds: readonly RiotMatchId[],
): Promise<readonly RiotMatchId[]> {
  if (!evidenceRecoveryEnabled() || matchIds.length === 0) return matchIds;
  const eligible: RiotMatchId[] = [];
  for (let offset = 0; offset < matchIds.length; offset += 500)
    eligible.push(
      ...(await eligibleMatchPage(matchIds.slice(offset, offset + 500))),
    );
  return eligible;
}

async function eligibleMatchPage(
  matchIds: readonly RiotMatchId[],
): Promise<readonly RiotMatchId[]> {
  const [admissions, observations] = await Promise.all([
    prisma.matchEvidenceAdmission.findMany({
      where: { riotMatchId: { in: [...matchIds] } },
      select: { riotMatchId: true, policy: true },
    }),
    prisma.matchObservation.findMany({
      where: {
        riotMatchId: { in: [...matchIds] },
        processingPolicy: "FULL",
        deliveryMode: "live",
      },
      select: { riotMatchId: true },
    }),
  ]);
  const policies = new Map(
    admissions.map((row) => [row.riotMatchId, PolicySchema.parse(row.policy)]),
  );
  const legacyLive = new Set(observations.map((row) => row.riotMatchId));
  return matchIds.filter(
    (id) =>
      policies.get(id) === "FULL" || (!policies.has(id) && legacyLive.has(id)),
  );
}

/** Late timelines cannot rewrite a processing decision that pinned absence. */
export async function effectTimelineMatchIds(
  matchIds: readonly RiotMatchId[],
): Promise<readonly RiotMatchId[]> {
  if (!evidenceRecoveryEnabled() || matchIds.length === 0) return matchIds;
  const eligible = await effectEligibleMatchIds(matchIds);
  const denied = new Set<RiotMatchId>();
  for (let offset = 0; offset < eligible.length; offset += 500) {
    const missing = await prisma.matchEvidenceAdmission.findMany({
      where: {
        riotMatchId: { in: eligible.slice(offset, offset + 500) },
        timelineMissing: true,
      },
      select: { riotMatchId: true },
    });
    for (const row of missing) denied.add(row.riotMatchId);
  }
  return eligible.filter((id) => !denied.has(id));
}

/** A processing result is not evidence that Riot can use its ID as a history anchor. */
export async function riotHistoryAnchorAllowed(
  matchId: RiotMatchId,
): Promise<boolean> {
  if (!evidenceRecoveryEnabled()) return true;
  const admission = await prisma.matchEvidenceAdmission.findUnique({
    where: { riotMatchId: matchId },
  });
  return (
    admission !== null &&
    admission.policy === "FULL" &&
    admission.riotHistoryListed
  );
}
