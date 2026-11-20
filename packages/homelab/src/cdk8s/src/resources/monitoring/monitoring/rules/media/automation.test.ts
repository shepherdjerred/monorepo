import { test } from "vitest";
import { runPromtoolFixture } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/platform/promtool-fixture.ts";
import { getMediaRuleGroups } from "./automation.ts";

function requireMediaExpression(alert: string): string {
  const expression = getMediaRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .find((rule) => rule.alert === alert)?.expr.value;
  if (typeof expression !== "string") {
    throw new TypeError(`Missing ${alert} expression`);
  }
  return expression;
}

test("watch alerts distinguish stale evidence from fresh, inactive, and unneeded observations", async () => {
  const expression = requireMediaExpression("MediaWatchEvidenceStale");
  const labels = '{namespace="media",pod="media-api"}';
  const cases = [
    {
      name: "missing evidence on an active household library",
      timestamp: 0,
      required: 1,
      active: 1,
      expected: [{ labels, value: 1200 }],
    },
    {
      name: "fresh evidence",
      timestamp: 1140,
      required: 1,
      active: 1,
      expected: [],
    },
    {
      name: "observe-only recovery",
      timestamp: 0,
      required: 1,
      active: 0,
      expected: [],
    },
    {
      name: "no non-owner requesters",
      timestamp: 0,
      required: 0,
      active: 1,
      expected: [],
    },
  ];
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: cases.map((entry) => ({
      name: entry.name,
      interval: "1m",
      input_series: [
        {
          series: `media_watch_evidence_oldest_timestamp_seconds${labels}`,
          values: `${String(entry.timestamp)}+0x20`,
        },
        {
          series: `media_watch_evidence_required${labels}`,
          values: `${String(entry.required)}+0x20`,
        },
        {
          series: `media_runtime_active${labels}`,
          values: `${String(entry.active)}+0x20`,
        },
      ],
      promql_expr_test: [
        { expr: expression, eval_time: "20m", exp_samples: entry.expected },
      ],
    })),
  });
});

test("reconciliation alerts gate on active runtime and collapse pod rollouts to namespace", async () => {
  const expression = requireMediaExpression(
    "MediaOperationsNeedReconciliation",
  );
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      {
        name: "active runtime across two pods during rollout collapses to one namespace series",
        interval: "1m",
        input_series: [
          {
            series:
              'media_operations_reconciling{namespace="media",pod="media-api-old"}',
            values: "63+0x20",
          },
          {
            series:
              'media_runtime_active{namespace="media",pod="media-api-old"}',
            values: "1+0x20",
          },
          {
            series:
              'media_operations_reconciling{namespace="media",pod="media-api-new"}',
            values: "63+0x20",
          },
          {
            series:
              'media_runtime_active{namespace="media",pod="media-api-new"}',
            values: "1+0x20",
          },
        ],
        promql_expr_test: [
          {
            expr: expression,
            eval_time: "20m",
            exp_samples: [{ labels: '{namespace="media"}', value: 63 }],
          },
        ],
      },
      {
        name: "observe-only runtime suppresses reconciliation alert",
        interval: "1m",
        input_series: [
          {
            series:
              'media_operations_reconciling{namespace="media",pod="media-api"}',
            values: "63+0x20",
          },
          {
            series: 'media_runtime_active{namespace="media",pod="media-api"}',
            values: "0+0x20",
          },
        ],
        promql_expr_test: [
          { expr: expression, eval_time: "20m", exp_samples: [] },
        ],
      },
    ],
  });
});
