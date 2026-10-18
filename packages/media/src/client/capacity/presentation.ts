import type {
  CapacityPublicReason,
  CapacityRoleView,
} from "#shared/capacity/view.ts";

export const capacityStates: Record<CapacityRoleView["state"], string> = {
  current: "Current measurement",
  missing: "Not measured",
  unavailable: "Unavailable",
  future: "Time check required",
  old_epoch: "New measurement required",
  root_changed: "Storage changed",
  stale: "Stale measurement",
};

export const capacityReasons: Record<CapacityPublicReason, string> = {
  mount_observation_failed: "The storage connection could not be checked.",
  mount_proof_invalid: "The storage connection could not be verified.",
  mount_missing: "The storage connection has not been observed yet.",
  mount_unavailable: "The storage connection is unavailable.",
  mount_expired: "The storage connection needs a fresh check.",
  mount_future: "The storage observation time could not be verified.",
  worker_mismatch: "The measurement worker has changed. A new check is needed.",
  root_configuration_mismatch:
    "The configured storage does not match the observation.",
  root_missing: "The storage directory is unavailable.",
  root_symlink: "The storage directory could not be verified.",
  root_not_directory: "The storage location is not a directory.",
  root_changed: "Storage changed during measurement. A new check is needed.",
  statfs_failed: "Filesystem capacity could not be measured.",
  capacity_invalid: "The filesystem returned an invalid capacity measurement.",
  capacity_overflow: "The measurement exceeds the supported capacity range.",
  sample_missing: "Capacity has not been measured yet.",
  sample_future: "The capacity measurement time could not be verified.",
  epoch_changed: "The measurement predates the current recovery state.",
  binding_changed: "The measurement belongs to a different storage connection.",
  sample_stale: "The last measurement is too old to report current capacity.",
};
