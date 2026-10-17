import {
  Prisma,
  type MediaCapacityObservation,
} from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  CAPACITY_MOUNT_MAX_AGE_MS,
  CAPACITY_ROOTS,
  CapacityBindingSchema,
  CapacityCycleSchema,
  CapacityMountResultSchema,
  type CapacityCycle,
  type CapacityMountResult,
  type CapacityRole,
} from "#shared/capacity/contract.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { serializable } from "#automation/store.ts";
import { lockCapacity, matchesCycle } from "./ordering.ts";
import { assertActive, type CapacityExecution } from "./execution.ts";

export function mountBinding(
  result: Extract<CapacityMountResult, { status: "observed" }>,
  role: CapacityRole,
  epoch: number,
) {
  const mount = result.evidence.mounts.find(
    (item) => item.root === CAPACITY_ROOTS[role],
  );
  if (mount === undefined) throw new Error("Capacity mount role missing");
  return CapacityBindingSchema.parse({
    schemaVersion: 1,
    role,
    rootPath: mount.root,
    pvcUid: mount.pvcUid,
    volumeName: mount.volumeName,
    volumePath: mount.volumePath,
    workerPodUid: mount.podUid,
    recoveryEpoch: epoch,
  });
}

export async function finishCapacityMounts(
  db: Database,
  rawCycle: CapacityCycle,
  rawResult: CapacityMountResult,
  execution: CapacityExecution,
): Promise<"stored" | "superseded"> {
  const cycle = CapacityCycleSchema.parse(rawCycle);
  const result = CapacityMountResultSchema.parse(rawResult);
  return await serializable(db, async (tx) => {
    assertActive(execution);
    const runtime = await lockCapacity(tx, execution);
    const rows = await tx.mediaCapacityObservation.findMany({
      orderBy: { role: "asc" },
    });
    if (
      !matchesCycle(rows, cycle, runtime.recoveryEpoch) ||
      rows.some((row) => row.mountResultRevision === row.cycleRevision)
    )
      return "superseded";
    const now = new Date();
    const accepted = acceptedMount(result, rows, now);
    for (const entry of cycle.cycles) {
      assertActive(execution);
      await tx.mediaCapacityObservation.update({
        where: { role: entry.role },
        data: {
          mountResultRevision: BigInt(entry.revision),
          mountEpoch: runtime.recoveryEpoch,
          mountCompletedAt: now,
          ...mountData(accepted, entry.role, runtime.recoveryEpoch),
        },
      });
      assertActive(execution);
    }
    return "stored";
  });
}

function acceptedMount(
  result: CapacityMountResult,
  rows: readonly MediaCapacityObservation[],
  now: Date,
): CapacityMountResult {
  if (result.status === "unavailable") return result;
  const observed = new Date(result.evidence.capturedAt);
  const expires = new Date(result.evidence.expiresAt);
  const valid =
    observed <= now &&
    expires > now &&
    expires > observed &&
    expires.getTime() - observed.getTime() <= CAPACITY_MOUNT_MAX_AGE_MS &&
    rows.every((row) => observed >= row.cycleStartedAt) &&
    result.evidence.configurationDigest ===
      snapshotHash(LEGACY_OBSERVER_CONFIG);
  return valid
    ? result
    : { status: "unavailable", reason: "mount_proof_invalid" };
}

function mountData(
  result: CapacityMountResult,
  role: CapacityRole,
  epoch: number,
): Prisma.MediaCapacityObservationUpdateInput {
  if (result.status === "unavailable")
    return {
      mountOutcome: "unavailable",
      mountReason: result.reason,
      mountObservedAt: null,
      mountExpiresAt: null,
      mountBinding: Prisma.DbNull,
      mountBindingDigest: null,
      mountEvidence: Prisma.DbNull,
    };
  const binding = mountBinding(result, role, epoch);
  return {
    mountOutcome: "observed",
    mountReason: null,
    mountObservedAt: new Date(result.evidence.capturedAt),
    mountExpiresAt: new Date(result.evidence.expiresAt),
    mountBinding: binding,
    mountBindingDigest: snapshotHash(binding),
    mountEvidence: result.evidence,
  };
}
