import { describe, it } from "vitest";
import { WOODPECKER_UV_CACHE_CLAIM } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/caches.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { pvcProjectedFullExpression } from "./resource-monitoring-expressions.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";

const HOURS = 8 * 24;
const CAPACITY = 1_000_000_000_000;

type ClaimGrowthOptions = {
  namespace: string;
  claim: string;
  initialUsedBytes: number;
  growthPerHourBytes: number;
  extraLabels?: string;
};

function growingClaim({
  namespace,
  claim,
  initialUsedBytes,
  growthPerHourBytes,
  extraLabels = "",
}: ClaimGrowthOptions) {
  const extra = extraLabels === "" ? "" : `,${extraLabels}`;
  const key = `namespace="${namespace}",persistentvolumeclaim="${claim}"${extra}`;
  const initialAvailable = CAPACITY - initialUsedBytes;
  return [
    {
      series: `kubelet_volume_stats_used_bytes{${key}}`,
      values: `${String(initialUsedBytes)}+${String(growthPerHourBytes)}x${String(HOURS)}`,
    },
    {
      series: `kubelet_volume_stats_available_bytes{${key}}`,
      values: `${String(initialAvailable)}-${String(growthPerHourBytes)}x${String(HOURS)}`,
    },
    {
      series: `kubelet_volume_stats_capacity_bytes{${key}}`,
      values: `${String(CAPACITY)}+0x${String(HOURS)}`,
    },
  ];
}

describe("PVC fill projection", () => {
  it("gates 60d warnings on >=50% utilization while keeping 14d critical unconditional and deduplicating scrape series", async () => {
    await runPromtoolFixture({
      evaluation_interval: "1h",
      tests: [
        {
          interval: "1h",
          input_series: [
            // <50% full (19.2% at 192h) with ~34d remaining: must NOT fire 60d warning or 14d critical.
            ...growingClaim({
              namespace: "media",
              claim: "bursty-under-half",
              initialUsedBytes: 0,
              growthPerHourBytes: 1_000_000_000,
            }),
            // >=50% full (59.2% at 192h) with ~17d remaining across two kubelet scrape targets:
            // deduplicates to a single series and fires 60d warning, not 14d critical.
            ...growingClaim({
              namespace: "media",
              claim: "library",
              initialUsedBytes: 400_000_000_000,
              growthPerHourBytes: 1_000_000_000,
              extraLabels: 'instance="kubelet-a"',
            }),
            ...growingClaim({
              namespace: "media",
              claim: "library",
              initialUsedBytes: 400_000_000_000,
              growthPerHourBytes: 1_000_000_000,
              extraLabels: 'instance="kubelet-b"',
            }),
            // <50% full (48.0% at 192h) with steep growth (~8.7d remaining):
            // suppressed on 60d warning (<50% floor), but DOES fire 14d critical unconditionally!
            ...growingClaim({
              namespace: "media",
              claim: "steep-under-half",
              initialUsedBytes: 0,
              growthPerHourBytes: 2_500_000_000,
            }),
            // Periodically pruned cache >=50% full: still skipped.
            ...growingClaim({
              namespace: WOODPECKER_CI_NAMESPACE,
              claim: WOODPECKER_UV_CACHE_CLAIM,
              initialUsedBytes: 400_000_000_000,
              growthPerHourBytes: 1_000_000_000,
            }),
            // Another >=50% claim in the same namespace is not exempt.
            ...growingClaim({
              namespace: WOODPECKER_CI_NAMESPACE,
              claim: "woodpecker-go-cache",
              initialUsedBytes: 400_000_000_000,
              growthPerHourBytes: 1_000_000_000,
            }),
          ],
          promql_expr_test: [
            {
              // Test rounded raw expression (no outer `count by`) so duplicate series would fail this assertion.
              expr: `round(${pvcProjectedFullExpression(60)})`,
              eval_time: `${String(HOURS)}h`,
              exp_samples: [
                {
                  labels: '{namespace="media",persistentvolumeclaim="library"}',
                  value: 1_468_800,
                },
                {
                  labels: `{namespace="${WOODPECKER_CI_NAMESPACE}",persistentvolumeclaim="woodpecker-go-cache"}`,
                  value: 1_468_800,
                },
              ],
            },
            {
              expr: `round(${pvcProjectedFullExpression(14)})`,
              eval_time: `${String(HOURS)}h`,
              exp_samples: [
                {
                  labels:
                    '{namespace="media",persistentvolumeclaim="steep-under-half"}',
                  value: 748_800,
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
