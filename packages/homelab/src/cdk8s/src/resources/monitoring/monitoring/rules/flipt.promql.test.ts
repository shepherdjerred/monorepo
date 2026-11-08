import { expect, test } from "vitest";
import { getFliptRuleGroups } from "./flipt.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";
import { LIVE_FLAG_STATES_QUERY } from "@shepherdjerred/homelab/cdk8s/grafana/feature-flags-dashboard.ts";

test("replacement observer OFF wins over old ON and stale observations disappear", async () => {
  const rules = getFliptRuleGroups().flatMap((group) => group.rules ?? []);
  const stale = rules.find(
    (rule) => rule.alert === "FeatureFlagInventoryObservationStale",
  )?.expr.value;
  const failingProvider = rules.find(
    (rule) => rule.alert === "FeatureFlagProviderInitFailing",
  )?.expr.value;
  if (typeof stale !== "string")
    throw new TypeError("Missing observation alert");
  if (typeof failingProvider !== "string")
    throw new TypeError("Missing provider readiness alert");
  expect(
    rules.find((rule) => rule.alert === "FeatureFlagExceptionReviewOverdue")
      ?.for,
  ).toBe("15m");
  expect(
    rules.find((rule) => rule.alert === "FeatureFlagEvaluationErrors")?.for,
  ).toBe("10m");
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      {
        interval: "1m",
        input_series: [
          ...["disabled", "failed", "ready"].map((instance) => ({
            series: `feature_flag_provider_ready{job="worker",instance="${instance}"}`,
            values: `${instance === "ready" ? "1" : "0"}+0x30`,
          })),
          ...["failed", "ready"].map((instance) => ({
            series: `feature_flag_provider_info{job="worker",instance="${instance}",flipt_environment="prod",flipt_namespace="temporal"}`,
            values: "1+0x30",
          })),
          {
            series:
              'feature_flag_inventory_expected{flipt_environment="prod",flipt_namespace="test"}',
            values: "1+0x30",
          },
          ...["old", "new"].flatMap((instance) => [
            {
              series: `feature_flag_inventory_observed_timestamp_seconds{job="worker",instance="${instance}",flipt_environment="prod",flipt_namespace="test"}`,
              values: instance === "old" ? "0+0x30" : "60+0x30",
            },
            ...["on", "off"].map((state) => ({
              series: `feature_flag_rollout_state{job="worker",instance="${instance}",flipt_environment="prod",flipt_namespace="test",flag="feature",state="${state}"}`,
              values: `${(instance === "old") === (state === "on") ? "1" : "0"}+0x30`,
            })),
          ]),
        ],
        promql_expr_test: [
          {
            expr: failingProvider,
            eval_time: "5m",
            exp_samples: [
              {
                labels:
                  'feature_flag_provider_ready{job="worker",instance="failed"}',
                value: 0,
              },
            ],
          },
          {
            expr: `sum((${LIVE_FLAG_STATES_QUERY}) * on (state) group_left() label_replace(vector(1), "state", "off", "", ""))`,
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
          {
            expr: `count(${LIVE_FLAG_STATES_QUERY})`,
            eval_time: "20m",
            exp_samples: [],
          },
          { expr: `count(${stale})`, eval_time: "5m", exp_samples: [] },
          {
            expr: `count(${stale})`,
            eval_time: "20m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
        ],
      },
    ],
  });
});
