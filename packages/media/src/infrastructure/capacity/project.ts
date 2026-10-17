import {
  CAPACITY_ROLES,
  CAPACITY_SAMPLE_MAX_AGE_MS,
  type CapacityRole,
} from "#shared/capacity/contract.ts";
import {
  CapacityViewSchema,
  type CapacityRoleView,
  type CapacityPublicReason,
} from "#shared/capacity/view.ts";
import type { CapacityRecord } from "./records.ts";

export type CapacitySnapshot = {
  recoveryEpoch: number;
  rows: CapacityRecord[];
};
export function projectCapacity(
  snapshot: CapacitySnapshot,
  options: { samplingEnabled: boolean; now: Date },
) {
  if (
    new Set(snapshot.rows.map((row) => row.role)).size !== snapshot.rows.length
  )
    throw new Error("Duplicate capacity role");
  return CapacityViewSchema.parse({
    schemaVersion: 1,
    samplingEnabled: options.samplingEnabled,
    asOf: options.now.toISOString(),
    roles: CAPACITY_ROLES.map((role) =>
      projectRole(
        role,
        snapshot.rows.find((row) => row.role === role),
        snapshot.recoveryEpoch,
        options.now,
      ),
    ),
  });
}
function projectRole(
  role: CapacityRole,
  row: CapacityRecord | undefined,
  epoch: number,
  now: Date,
): CapacityRoleView {
  const sample = row?.sample;
  const sampledAt =
    sample?.outcome === "observed" && sample.observedAt <= now
      ? sample.observedAt.toISOString()
      : null;
  const result = (
    state: CapacityRoleView["state"],
    reason: CapacityPublicReason,
  ): CapacityRoleView => ({
    role,
    state,
    reason,
    sampledAt,
    totalBytes: null,
    availableBytes: null,
  });
  const mount = row?.mount;
  if (mount === undefined || mount === null)
    return result("missing", "mount_missing");
  if (futureObservation(mount, now)) return result("future", "mount_future");
  if (mount.epoch !== epoch) return result("old_epoch", "epoch_changed");
  if (mount.outcome === "unavailable")
    return result("unavailable", mount.reason);
  if (mount.expiresAt <= now) return result("unavailable", "mount_expired");
  if (sample === undefined || sample === null)
    return result("missing", "sample_missing");
  if (sample.startedAt > now || futureObservation(sample, now))
    return result("future", "sample_future");
  if (sample.epoch !== epoch) return result("old_epoch", "epoch_changed");
  if (sample.outcome === "unavailable")
    return result("unavailable", sample.reason);
  if (sample.bindingDigest !== mount.bindingDigest)
    return result("root_changed", "binding_changed");
  if (now.getTime() - sample.observedAt.getTime() > CAPACITY_SAMPLE_MAX_AGE_MS)
    return result("stale", "sample_stale");
  return {
    role,
    state: "current",
    reason: null,
    sampledAt,
    totalBytes: sample.totalBytes.toString(),
    availableBytes: sample.availableBytes.toString(),
  };
}

function futureObservation(
  value: NonNullable<CapacityRecord["mount"] | CapacityRecord["sample"]>,
  now: Date,
) {
  return (
    value.completedAt > now ||
    (value.outcome === "observed" && value.observedAt > now)
  );
}
