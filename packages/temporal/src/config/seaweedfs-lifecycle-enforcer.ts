import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import type { LifecycleMode } from "#shared/seaweedfs-lifecycle/types.ts";

/** Resolved policy for one SeaweedFS lifecycle sweep. */
export type SeaweedfsLifecyclePolicy = {
  /** `delete` only when the flag says so and the Flags snapshot was fresh. */
  mode: LifecycleMode;
  /** Per-run cap on deleted objects, across every bucket. */
  maxDeletes: number;
  /** Buckets that may be deleted from; `"*"` is every bucket. */
  buckets: readonly string[] | "*";
  provenance: { mode: string; maxDeletes: string; buckets: string };
};

export function parseBucketAllowlist(raw: string): readonly string[] | "*" {
  return raw === "*" ? "*" : raw.split(",").map((name) => name.trim());
}

/**
 * Deletion is opt-in: the schedule starts paused, the mode defaults to
 * `report`, and an unavailable or failing Flags source resolves to `report`
 * rather than to whatever stale value a cache still holds.
 */
export async function seaweedfsLifecycleEnforcerConfig(): Promise<SeaweedfsLifecyclePolicy> {
  const availability = { value: true };
  const resolver = defineConfig({
    definition: {
      mode: {
        schema: flagValueSchema("seaweedfs-lifecycle-enforcer-mode"),
        sources: ["flag", "default"],
        default: "report",
        names: { flag: "seaweedfs-lifecycle-enforcer-mode" },
      },
      maxDeletes: {
        schema: flagValueSchema("seaweedfs-lifecycle-enforcer-max-deletes"),
        sources: ["flag", "default"],
        default: 20_000,
        names: { flag: "seaweedfs-lifecycle-enforcer-max-deletes" },
      },
      buckets: {
        schema: flagValueSchema("seaweedfs-lifecycle-enforcer-buckets"),
        sources: ["flag", "default"],
        default: "*",
        names: { flag: "seaweedfs-lifecycle-enforcer-buckets" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "seaweedfs-lifecycle-enforcer-prod",
        attributes: { environment: "prod" },
        kinds: {
          mode: flagValueKind("seaweedfs-lifecycle-enforcer-mode"),
          maxDeletes: flagValueKind("seaweedfs-lifecycle-enforcer-max-deletes"),
          buckets: flagValueKind("seaweedfs-lifecycle-enforcer-buckets"),
        },
        requireFreshSnapshot: true,
        onUnavailable: () => {
          availability.value = false;
        },
      }),
    },
    hooks: {
      onSourceError: () => {
        availability.value = false;
      },
    },
  });
  const [mode, maxDeletes, buckets] = await Promise.all([
    resolver.get("mode"),
    resolver.get("maxDeletes"),
    resolver.get("buckets"),
  ]);
  return {
    mode: availability.value ? mode.value : "report",
    maxDeletes: maxDeletes.value,
    buckets: parseBucketAllowlist(buckets.value),
    provenance: {
      mode: mode.source,
      maxDeletes: maxDeletes.source,
      buckets: buckets.source,
    },
  };
}
