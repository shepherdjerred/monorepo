import { expect, test } from "vitest";
import { getFlagsRuleGroups } from "./flags.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";
import { LIVE_FLAG_STATES_QUERY } from "@shepherdjerred/homelab/cdk8s/grafana/feature-flags-dashboard.ts";

function ruleExpressions() {
  const rules = getFlagsRuleGroups().flatMap((group) => group.rules ?? []);
  const overdue = rules.find(
    (rule) => rule.alert === "FeatureFlagExceptionReviewOverdue",
  )?.expr.value;
  const stale = rules.find(
    (rule) => rule.alert === "FeatureFlagInventoryObservationStale",
  )?.expr.value;
  const failingProvider = rules.find(
    (rule) => rule.alert === "FeatureFlagProviderInitFailing",
  )?.expr.value;
  const flagsDown = rules.find((rule) => rule.alert === "FlagsDown")?.expr
    .value;
  const snapshotStale = rules.find(
    (rule) => rule.alert === "FeatureFlagSnapshotStale",
  )?.expr.value;
  if (typeof overdue !== "string")
    throw new TypeError("Missing overdue exception review alert");
  if (typeof stale !== "string")
    throw new TypeError("Missing observation alert");
  if (typeof failingProvider !== "string")
    throw new TypeError("Missing provider readiness alert");
  if (typeof flagsDown !== "string")
    throw new TypeError("Missing FlagsDown alert");
  if (typeof snapshotStale !== "string")
    throw new TypeError("Missing FeatureFlagSnapshotStale alert");
  return { rules, overdue, stale, failingProvider, flagsDown, snapshotStale };
}

test("replacement observer OFF wins over old ON and stale observations disappear", async () => {
  const { rules, overdue, stale, failingProvider, flagsDown, snapshotStale } =
    ruleExpressions();
  expect(rules.map((rule) => rule.alert)).toEqual([
    "FeatureFlagExceptionReviewOverdue",
    "FeatureFlagEvaluationErrors",
    "FeatureFlagInventoryObservationStale",
    "FlagsDown",
    "FeatureFlagSnapshotStale",
    "FeatureFlagProviderInitFailing",
  ]);
  expect(flagsDown).toBe(
    '(up{namespace="flags",service="flags"} == 0) or absent(up{namespace="flags",service="flags"})',
  );
  expect(snapshotStale).toBe(
    'feature_flag_snapshot_age_seconds{pod!~".*-delivery-wf-retained-.*"} > 3600',
  );
  expect(rules.find((rule) => rule.alert === "FlagsDown")?.for).toBe("5m");
  expect(
    rules.find((rule) => rule.alert === "FeatureFlagExceptionReviewOverdue")
      ?.for,
  ).toBe("15m");
  expect(
    rules.find((rule) => rule.alert === "FeatureFlagEvaluationErrors")?.for,
  ).toBe("10m");
  for (const flagRule of rules) {
    expect(flagRule.annotations?.["summary"]).toMatch(/\S/u);
    expect(flagRule.annotations?.["description"]).toMatch(/\S/u);
    expect(flagRule.annotations?.["message"]).toBeUndefined();
  }
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
            series: `feature_flag_provider_info{job="worker",instance="${instance}",deployment="temporal/prod"}`,
            values: "1+0x30",
          })),
          {
            series:
              'feature_flag_inventory_expected{container="temporal-repo-worker",pod="temporal-temporal-repo-worker-abc",deployment="scout/prod"}',
            values: "1+0x30",
          },
          {
            series:
              'feature_flag_exception_review_timestamp_seconds{job="worker",deployment="scout/prod",flag="feature",issue="AI-100"}',
            values: "600+0x30",
          },
          ...["old", "new"].flatMap((instance) => [
            {
              series: `feature_flag_inventory_observed_timestamp_seconds{job="worker",instance="${instance}",deployment="scout/prod"}`,
              values: instance === "old" ? "0+0x30" : "60+0x30",
            },
            ...["on", "off"].map((state) => ({
              series: `feature_flag_rollout_state{job="worker",instance="${instance}",deployment="scout/prod",flag="feature",state="${state}"}`,
              values: `${(instance === "old") === (state === "on") ? "1" : "0"}+0x30`,
            })),
          ]),
          {
            series:
              'feature_flag_snapshot_age_seconds{job="temporal",instance="10.244.0.1:9090",pod="temporal-delivery-wf-retained-cc39fe6dcb6a-abcde"}',
            values: "7200+0x30",
          },
          {
            series:
              'feature_flag_snapshot_age_seconds{job="temporal",instance="10.244.0.2:9090",pod="temporal-workflows-candidate-abcde"}',
            values: "7200+0x30",
          },
        ],
        promql_expr_test: [
          {
            expr: snapshotStale,
            eval_time: "5m",
            exp_samples: [
              {
                labels:
                  'feature_flag_snapshot_age_seconds{instance="10.244.0.2:9090",job="temporal",pod="temporal-workflows-candidate-abcde"}',
                value: 7200,
              },
            ],
          },
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
          { expr: `count(${overdue})`, eval_time: "5m", exp_samples: [] },
          {
            expr: `count(${overdue})`,
            eval_time: "20m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
          { expr: `count(${stale})`, eval_time: "5m", exp_samples: [] },
          {
            expr: `count(${stale})`,
            eval_time: "20m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
          {
            expr: `count(${flagsDown})`,
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
        ],
      },
    ],
  });
});

test("ignores retained workflow pods exporting feature_flag_inventory_expected", async () => {
  const { stale } = ruleExpressions();
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      {
        interval: "1m",
        input_series: [
          {
            series:
              'feature_flag_inventory_expected{container="temporal-repo-worker",pod="temporal-temporal-repo-worker-live",deployment="scout/prod"}',
            values: "1+0x10",
          },
          {
            series:
              'feature_flag_inventory_expected{container="temporal-repo-worker",pod="temporal-delivery-wf-retained-abc",deployment="retired/prod"}',
            values: "1+0x10",
          },
          {
            series:
              'feature_flag_inventory_observed_timestamp_seconds{job="worker",instance="live",deployment="scout/prod"}',
            values: "60+0x10",
          },
        ],
        promql_expr_test: [
          { expr: `count(${stale})`, eval_time: "5m", exp_samples: [] },
        ],
      },
      {
        interval: "1m",
        input_series: [
          {
            series:
              'feature_flag_inventory_expected{container="temporal-repo-worker",pod="temporal-delivery-wf-retained-abc",deployment="scout/prod"}',
            values: "1+0x10",
          },
          {
            series:
              'feature_flag_inventory_observed_timestamp_seconds{job="worker",instance="retained",deployment="scout/prod"}',
            values: "60+0x10",
          },
        ],
        promql_expr_test: [
          {
            expr: `count(${stale})`,
            eval_time: "5m",
            exp_samples: [{ labels: "{}", value: 1 }],
          },
        ],
      },
    ],
  });
});
