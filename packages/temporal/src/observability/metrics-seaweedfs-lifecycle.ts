import { Counter, Gauge } from "prom-client";
import { register } from "./metrics.ts";

// SeaweedFS does not enforce lifecycle Expiration; the daily sweep does. Labels
// are bounded: `bucket` is the small SeaweedFS bucket inventory and `rule` is a
// lifecycle rule ID declared in the seaweedfs OpenTofu stack.

export const seaweedfsLifecycleCandidates = new Gauge({
  name: "seaweedfs_lifecycle_candidates_total",
  help: "Objects the last SeaweedFS lifecycle sweep found past a rule's Expiration, by bucket and rule",
  labelNames: ["bucket", "rule"] as const,
  registers: [register],
});

export const seaweedfsLifecycleCandidateBytes = new Gauge({
  name: "seaweedfs_lifecycle_candidate_bytes",
  help: "Bytes of the objects the last SeaweedFS lifecycle sweep found past a rule's Expiration",
  labelNames: ["bucket", "rule"] as const,
  registers: [register],
});

export const seaweedfsLifecycleDeleted = new Counter({
  name: "seaweedfs_lifecycle_deleted_total",
  help: "Objects the SeaweedFS lifecycle sweep deleted for expiry, by bucket and rule",
  labelNames: ["bucket", "rule"] as const,
  registers: [register],
});

export const seaweedfsLifecycleLastRunTimestamp = new Gauge({
  name: "seaweedfs_lifecycle_last_run_timestamp_seconds",
  help: "Completion time of the last SeaweedFS lifecycle sweep, by the mode it ran in",
  labelNames: ["mode"] as const,
  registers: [register],
});

export const seaweedfsLifecycleBucketFailed = new Gauge({
  name: "seaweedfs_lifecycle_bucket_failed",
  help: "1 when the last SeaweedFS lifecycle sweep could not finish a bucket",
  labelNames: ["bucket"] as const,
  registers: [register],
});
