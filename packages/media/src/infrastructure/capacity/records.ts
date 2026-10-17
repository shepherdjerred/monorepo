import { z } from "zod";
import type { MediaCapacityObservation } from "#generated/prisma/client.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import {
  CapacityBindingSchema,
  CapacityRoleSchema,
  CapacityIdentitySchema,
  CapacityMountReasonSchema,
  CapacitySampleReasonSchema,
  CAPACITY_MAX_BYTES,
  CAPACITY_MOUNT_MAX_AGE_MS,
} from "#shared/capacity/contract.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const MountRecordSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("unavailable"),
    reason: CapacityMountReasonSchema,
    epoch: z.int().nonnegative(),
    completedAt: z.date(),
  }),
  z.strictObject({
    outcome: z.literal("observed"),
    epoch: z.int().nonnegative(),
    observedAt: z.date(),
    completedAt: z.date(),
    expiresAt: z.date(),
    binding: CapacityBindingSchema,
    bindingDigest: z.string(),
    evidence: CanonicalMountEvidenceSchema,
  }),
]);
const SampleRecordSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("unavailable"),
    reason: CapacitySampleReasonSchema,
    epoch: z.int().nonnegative(),
    startedAt: z.date(),
    completedAt: z.date(),
  }),
  z.strictObject({
    outcome: z.literal("observed"),
    epoch: z.int().nonnegative(),
    startedAt: z.date(),
    observedAt: z.date(),
    completedAt: z.date(),
    binding: CapacityBindingSchema,
    bindingDigest: z.string(),
    identity: CapacityIdentitySchema,
    totalBytes: z.bigint().positive().max(CAPACITY_MAX_BYTES),
    availableBytes: z.bigint().nonnegative().max(CAPACITY_MAX_BYTES),
  }),
]);

export function decodeCapacityRow(row: MediaCapacityObservation) {
  const role = CapacityRoleSchema.parse(row.role);
  const mount =
    row.mountOutcome === null
      ? null
      : MountRecordSchema.parse(
          row.mountOutcome === "unavailable"
            ? {
                outcome: row.mountOutcome,
                reason: row.mountReason,
                epoch: row.mountEpoch,
                completedAt: row.mountCompletedAt,
              }
            : {
                outcome: row.mountOutcome,
                epoch: row.mountEpoch,
                completedAt: row.mountCompletedAt,
                observedAt: row.mountObservedAt,
                expiresAt: row.mountExpiresAt,
                binding: row.mountBinding,
                bindingDigest: row.mountBindingDigest,
                evidence: row.mountEvidence,
              },
        );
  const sample =
    row.sampleOutcome === null
      ? null
      : SampleRecordSchema.parse(
          row.sampleOutcome === "unavailable"
            ? {
                outcome: row.sampleOutcome,
                reason: row.sampleReason,
                epoch: row.sampleEpoch,
                startedAt: row.sampleStartedAt,
                completedAt: row.sampleCompletedAt,
              }
            : {
                outcome: row.sampleOutcome,
                epoch: row.sampleEpoch,
                startedAt: row.sampleStartedAt,
                observedAt: row.sampleObservedAt,
                completedAt: row.sampleCompletedAt,
                binding: row.sampleBinding,
                bindingDigest: row.sampleBindingDigest,
                identity: row.sampleIdentity,
                totalBytes: row.totalBytes,
                availableBytes: row.availableBytes,
              },
        );
  if (mount?.outcome === "observed") assertMountRecord(role, mount);
  if (
    sample?.outcome === "observed" &&
    (sample.binding.role !== role ||
      sample.binding.recoveryEpoch !== sample.epoch ||
      snapshotHash(sample.binding) !== sample.bindingDigest ||
      sample.availableBytes > sample.totalBytes ||
      sample.startedAt > sample.observedAt ||
      sample.observedAt > sample.completedAt)
  )
    throw new Error("Invalid stored capacity sample");
  return { role, mount, sample };
}

function assertMountRecord(
  role: string,
  mount: Extract<z.infer<typeof MountRecordSchema>, { outcome: "observed" }>,
) {
  const observed = mount.evidence.mounts.find(
    (value) => value.root === mount.binding.rootPath,
  );
  if (
    observed === undefined ||
    mount.binding.role !== role ||
    mount.binding.recoveryEpoch !== mount.epoch ||
    snapshotHash(mount.binding) !== mount.bindingDigest ||
    mount.binding.pvcUid !== observed.pvcUid ||
    mount.binding.volumeName !== observed.volumeName ||
    mount.binding.volumePath !== observed.volumePath ||
    mount.binding.workerPodUid !== observed.podUid ||
    mount.observedAt.toISOString() !== mount.evidence.capturedAt ||
    mount.expiresAt.toISOString() !== mount.evidence.expiresAt ||
    mount.observedAt > mount.completedAt ||
    mount.expiresAt <= mount.observedAt ||
    mount.expiresAt.getTime() - mount.observedAt.getTime() >
      CAPACITY_MOUNT_MAX_AGE_MS
  )
    throw new Error("Invalid stored capacity mount evidence");
}
export type CapacityRecord = ReturnType<typeof decodeCapacityRow>;
