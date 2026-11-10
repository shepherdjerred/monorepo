import { describe, it } from "vitest";
import { WOODPECKER_UV_CACHE_CLAIM } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/caches.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { pvcProjectedFullExpression } from "./resource-monitoring-expressions.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";

const HOURS = 8 * 24;
const GROWTH_PER_HOUR = 1_000_000_000;
const CAPACITY = 1_000_000_000_000;

/**
 * A claim growing 1 GB/h for eight days on a 1 TB volume: at the eval time it
 * has 808 GB left at ~278 kB/s, about 34 days from full — inside the 60-day
 * window and outside the 14-day one.
 */
function growingClaim(namespace: string, claim: string) {
  const key = `namespace="${namespace}",persistentvolumeclaim="${claim}"`;
  return [
    {
      series: `kubelet_volume_stats_used_bytes{${key}}`,
      values: `0+${String(GROWTH_PER_HOUR)}x${String(HOURS)}`,
    },
    {
      series: `kubelet_volume_stats_available_bytes{${key}}`,
      values: `${String(CAPACITY)}-${String(GROWTH_PER_HOUR)}x${String(HOURS)}`,
    },
    {
      series: `kubelet_volume_stats_capacity_bytes{${key}}`,
      values: `${String(CAPACITY)}+0x${String(HOURS)}`,
    },
  ];
}

function firingClaims(days: number): string {
  return `count by (namespace, persistentvolumeclaim) (${pvcProjectedFullExpression(days)})`;
}

describe("PVC fill projection", () => {
  it("skips periodically pruned caches but still projects ordinary claims", async () => {
    await runPromtoolFixture({
      evaluation_interval: "1h",
      tests: [
        {
          interval: "1h",
          input_series: [
            ...growingClaim("media", "library"),
            ...growingClaim(WOODPECKER_CI_NAMESPACE, WOODPECKER_UV_CACHE_CLAIM),
            // Another claim in the same namespace is not exempt.
            ...growingClaim(WOODPECKER_CI_NAMESPACE, "woodpecker-go-cache"),
          ],
          promql_expr_test: [
            {
              expr: firingClaims(60),
              eval_time: `${String(HOURS)}h`,
              exp_samples: [
                {
                  labels: '{namespace="media",persistentvolumeclaim="library"}',
                  value: 1,
                },
                {
                  labels: `{namespace="${WOODPECKER_CI_NAMESPACE}",persistentvolumeclaim="woodpecker-go-cache"}`,
                  value: 1,
                },
              ],
            },
            {
              expr: firingClaims(14),
              eval_time: `${String(HOURS)}h`,
              exp_samples: [],
            },
          ],
        },
      ],
    });
  });
});
