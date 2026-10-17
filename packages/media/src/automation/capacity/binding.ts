import type { MediaCapacityObservation } from "#generated/prisma/client.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import {
  CapacityBindingSchema,
  CAPACITY_MOUNT_MAX_AGE_MS,
  type CapacitySampleReason,
} from "#shared/capacity/contract.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { mountBinding } from "./mounts.ts";

export function readSampleBinding(
  row: MediaCapacityObservation,
  now: Date,
):
  | { status: "ready"; binding: ReturnType<typeof CapacityBindingSchema.parse> }
  | { status: "unavailable"; reason: CapacitySampleReason } {
  if (
    row.mountOutcome === null ||
    row.mountResultRevision !== row.cycleRevision
  )
    return { status: "unavailable", reason: "mount_missing" };
  if (row.mountOutcome === "unavailable")
    return { status: "unavailable", reason: "mount_unavailable" };
  if (row.mountOutcome !== "observed")
    throw new Error("Invalid capacity mount outcome");
  const binding = CapacityBindingSchema.parse(row.mountBinding);
  const evidence = CanonicalMountEvidenceSchema.parse(row.mountEvidence);
  const expected = mountBinding(
    { status: "observed", evidence },
    binding.role,
    row.cycleEpoch,
  );
  if (
    row.role !== binding.role ||
    row.mountEpoch !== row.cycleEpoch ||
    snapshotHash(binding) !== row.mountBindingDigest ||
    snapshotHash(expected) !== row.mountBindingDigest ||
    row.mountObservedAt?.toISOString() !== evidence.capturedAt ||
    row.mountExpiresAt?.toISOString() !== evidence.expiresAt ||
    row.mountCompletedAt === null
  )
    throw new Error("Inconsistent capacity mount binding");
  const start = Date.parse(evidence.capturedAt);
  const end = Date.parse(evidence.expiresAt);
  if (end <= start || end - start > CAPACITY_MOUNT_MAX_AGE_MS)
    throw new Error("Invalid capacity mount lifetime");
  if (start > now.getTime() || row.mountCompletedAt > now)
    return { status: "unavailable", reason: "mount_future" };
  return end <= now.getTime()
    ? { status: "unavailable", reason: "mount_expired" }
    : { status: "ready", binding };
}
