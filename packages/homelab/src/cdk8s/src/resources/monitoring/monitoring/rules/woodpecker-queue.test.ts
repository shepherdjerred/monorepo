import { describe, expect, it } from "vitest";
import { CI_ADMISSION_BUDGET } from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";
import { CI_KUBE_STATE_METRICS_VALUES } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/grafana-values.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";
import {
  CI_AGENT_CONFIGURED_SLOTS_METRIC,
  CI_AGENT_MAX_WORKFLOWS_KSM_LABEL,
  CI_AGENT_MAX_WORKFLOWS_LABEL_LIMIT,
  getWoodpeckerQueueAlertRules,
  getWoodpeckerQueueRecordingRules,
} from "./woodpecker-queue.ts";

const rules = getWoodpeckerQueueAlertRules();

function alert(name: string) {
  const rule = rules.find((candidate) => candidate.alert === name);
  if (rule === undefined) throw new Error(`missing alert ${name}`);
  return { rule, expr: String(rule.expr.value) };
}

const [recording] = getWoodpeckerQueueRecordingRules();
const RECORDED_EXPR = String(recording?.expr.value);

// The alert reads the recorded series; promtool evaluates expressions, so the
// recording rule's own expression stands in for it.
const DISCONNECTED_EXPR = alert("WoodpeckerAgentDisconnected").expr.replace(
  CI_AGENT_CONFIGURED_SLOTS_METRIC,
  `(${RECORDED_EXPR})`,
);
const LABEL_MISSING_EXPR = alert("WoodpeckerAgentSlotLabelMissing").expr;

const deployment = (pool: string) =>
  `namespace="woodpecker",deployment="woodpecker-woodpecker-agent-${pool}"`;

// A label value cannot vary over time in one series, so a cap that changes is
// two series (the old label value ending, the new one starting), which is what
// kube-state-metrics does.
function capSeries(pool: string, label: string, values: string) {
  return {
    series: `kube_deployment_labels{${deployment(pool)},${CI_AGENT_MAX_WORKFLOWS_KSM_LABEL}="${label}"}`,
    values,
  };
}

function availableSeries(pool: string, values: string, extra = "") {
  return {
    series: `kube_deployment_status_replicas_available{${deployment(pool)}${extra}}`,
    values,
  };
}

function agentFleet(caps: Record<string, number>, available = "1x20") {
  return Object.entries(caps).flatMap(([pool, cap]) => [
    capSeries(pool, String(cap), "1x20"),
    availableSeries(pool, available),
  ]);
}

function server(workers: string, running: string) {
  return [
    {
      series: 'woodpecker_worker_count{namespace="woodpecker"}',
      values: workers,
    },
    {
      series: 'woodpecker_running_steps{namespace="woodpecker"}',
      values: running,
    },
  ];
}

const FLEET = { pr: 8, main: 4, review: 3, completion: 1 };

function expectation(
  expr: string,
  evalTime: string,
  value: number | undefined,
) {
  return {
    expr,
    eval_time: evalTime,
    exp_samples: value === undefined ? [] : [{ labels: "{}", value }],
  };
}

function firing(deploymentName: string) {
  return {
    labels: `{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-${deploymentName}"}`,
    value: 1,
  };
}

describe("Woodpecker agent slot alerts", () => {
  it("are warnings (info routes to the null receiver) with the planned holds", () => {
    expect(alert("WoodpeckerAgentDisconnected").rule.for).toBe("10m");
    expect(alert("WoodpeckerAgentSlotLabelMissing").rule.for).toBe("30m");
    for (const name of [
      "WoodpeckerAgentDisconnected",
      "WoodpeckerAgentSlotLabelMissing",
    ]) {
      expect(alert(name).rule.labels?.["severity"]).toBe("warning");
    }
    // Pods that are down are the built-in KubeDeploymentReplicasMismatch.
    expect(rules.map((rule) => rule.alert)).not.toContain(
      "WoodpeckerAgentDeploymentUnavailable",
    );
  });

  // The expected capacity is what the cluster runs. It must not come from the
  // admission budget in this source, which leads the live agents between a cap
  // change merging and its rollout.
  it("reads expected slots from live Deployment labels, not the source budget", () => {
    expect(RECORDED_EXPR).toContain("kube_deployment_labels");
    expect(RECORDED_EXPR).toContain(CI_AGENT_MAX_WORKFLOWS_KSM_LABEL);
    expect(alert("WoodpeckerAgentDisconnected").expr).toContain(
      CI_AGENT_CONFIGURED_SLOTS_METRIC,
    );
    expect(DISCONNECTED_EXPR).not.toContain(
      `< ${String(CI_ADMISSION_BUDGET.maxWorkflows)}`,
    );
    expect(CI_AGENT_MAX_WORKFLOWS_KSM_LABEL).toBe(
      "label_ci_sjer_red_max_workflows",
    );
    // kube-state-metrics must export the label the rule reads.
    expect(CI_KUBE_STATE_METRICS_VALUES.metricLabelsAllowlist).toContain(
      "deployments=[ci.sjer.red/max-workflows]",
    );
    // The label enumeration covers every cap the budget can declare.
    const caps = [
      CI_ADMISSION_BUDGET.legacyMaxWorkflows,
      ...Object.values(CI_ADMISSION_BUDGET.pools).map(
        (pool) => pool.maxWorkflows,
      ),
    ];
    for (const cap of caps) {
      expect(cap).toBeLessThanOrEqual(CI_AGENT_MAX_WORKFLOWS_LABEL_LIMIT);
    }
  });

  it("pages when a running pool agent is not connected, never for a busy or resized fleet", async () => {
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          name: "healthy fleet",
          input_series: [...agentFleet(FLEET), ...server("9x20", "7x20")],
          promql_expr_test: [
            expectation(RECORDED_EXPR, "5m", 16),
            expectation(DISCONNECTED_EXPR, "5m", undefined),
          ],
        },
        {
          interval: "1m",
          name: "every one of the 16 slots busy",
          input_series: [...agentFleet(FLEET), ...server("0x20", "16x20")],
          promql_expr_test: [expectation(DISCONNECTED_EXPR, "5m", undefined)],
        },
        {
          // The 8-slot `pr` agent pod is up but disconnected: 4 idle + 4
          // running of the other pools' 8 slots, against 16 configured.
          interval: "1m",
          name: "a running pool agent lost its connection",
          input_series: [...agentFleet(FLEET), ...server("4x20", "4x20")],
          promql_expr_test: [expectation(DISCONNECTED_EXPR, "5m", 8)],
        },
        {
          // Labels not exported yet (before the agents are relabelled): no
          // expected capacity, so no page.
          interval: "1m",
          name: "no slot labels yet",
          input_series: server("9x20", "7x20"),
          promql_expr_test: [
            expectation(RECORDED_EXPR, "5m", undefined),
            expectation(DISCONNECTED_EXPR, "5m", undefined),
          ],
        },
        {
          // A cap change reaches the cluster as one rollout: `main` goes 4 -> 10
          // (the Deployment label changes, the Recreate pod is unavailable for
          // two minutes, then 6 more slots connect). The source budget says 22
          // from the merge on; the expression never looks at it, and the
          // recorded expected capacity (the dashboard line) follows the rollout.
          interval: "1m",
          name: "main's cap rises from 4 to 10 mid-window",
          input_series: [
            capSeries("pr", "8", "1x24"),
            capSeries("review", "3", "1x24"),
            capSeries("completion", "1", "1x24"),
            capSeries("main", "4", "1x5 _x19"),
            capSeries("main", "10", "_x6 1x18"),
            ...["pr", "review", "completion"].map((pool) =>
              availableSeries(pool, "1x24"),
            ),
            availableSeries("main", "1x5 0x1 1x16"),
            // 16 slots connected, 12 while main's pod is down, then 22.
            ...server("9x5 5x1 15x16", "7x24"),
          ],
          promql_expr_test: [
            expectation(DISCONNECTED_EXPR, "3m", undefined),
            expectation(DISCONNECTED_EXPR, "7m", undefined),
            expectation(DISCONNECTED_EXPR, "20m", undefined),
            expectation(RECORDED_EXPR, "3m", 16),
            expectation(RECORDED_EXPR, "7m", 12),
            expectation(RECORDED_EXPR, "20m", 22),
          ],
        },
        {
          // A kube-state-metrics restart exposes each Deployment from two
          // pods for a few minutes; that must not fail the match.
          interval: "1m",
          name: "duplicate series from two kube-state-metrics pods",
          input_series: [
            ...agentFleet({ pr: 8 }),
            availableSeries("pr", "1x20", ',pod="ksm-b"'),
            ...server("8x20", "0x20"),
          ],
          promql_expr_test: [
            expectation(RECORDED_EXPR, "5m", 8),
            expectation(DISCONNECTED_EXPR, "5m", undefined),
          ],
        },
        {
          // `pr` crash-loops: its slots leave the expected total with it, so
          // the slot comparison stays quiet at 4 of 4. That page is the
          // built-in KubeDeploymentReplicasMismatch's.
          interval: "1m",
          name: "an unavailable pool leaves both sides",
          input_series: [
            capSeries("pr", "8", "1x20"),
            availableSeries("pr", "0x20"),
            ...agentFleet({ main: 4 }),
            ...server("4x20", "0x20"),
          ],
          promql_expr_test: [
            expectation(RECORDED_EXPR, "5m", 4),
            expectation(DISCONNECTED_EXPR, "5m", undefined),
          ],
        },
      ],
    });
  });
});

// A pool whose pod is down is the live kube-prometheus-stack alert's, not this
// file's. Its expression (the live PrometheusRule's, warning, for 15m) matches
// every Deployment, so it covers a crash-looping one-replica agent such as the
// planned `maintenance` pool.
const BUILT_IN_REPLICAS_MISMATCH = `(
  kube_deployment_spec_replicas{job="kube-state-metrics", namespace=~".*"}
    >
  kube_deployment_status_replicas_available{job="kube-state-metrics", namespace=~".*"}
) and (
  changes(kube_deployment_status_replicas_updated{job="kube-state-metrics", namespace=~".*"}[10m])
    ==
  0
)`;

describe("Woodpecker agent pods that are down", () => {
  it("are covered by the built-in KubeDeploymentReplicasMismatch, including a one-replica pool", async () => {
    const ksm = `job="kube-state-metrics",${deployment("maintenance")}`;
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          name: "crash-looping one-replica maintenance agent",
          input_series: [
            { series: `kube_deployment_spec_replicas{${ksm}}`, values: "1x20" },
            {
              series: `kube_deployment_status_replicas_available{${ksm}}`,
              values: "0x20",
            },
            {
              series: `kube_deployment_status_replicas_updated{${ksm}}`,
              values: "1x20",
            },
          ],
          promql_expr_test: [
            {
              // The comparison keeps the desired replica count (1).
              expr: BUILT_IN_REPLICAS_MISMATCH,
              eval_time: "15m",
              exp_samples: [
                {
                  labels: `{__name__="kube_deployment_spec_replicas",deployment="woodpecker-woodpecker-agent-maintenance",job="kube-state-metrics",namespace="woodpecker"}`,
                  value: 1,
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe("Woodpecker agent slot label contract alert", () => {
  // If the label, the allowlist entry or the 1..64 range breaks, the expected
  // total silently drops agents; this alert makes that loud, and stays quiet
  // before the label has ever been exported.
  it("pages when a running agent has no readable slot label, and not before the first export", async () => {
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          name: "before the first rollout: no agent exports the label",
          input_series: [
            availableSeries("pr", "1x20"),
            availableSeries("main", "1x20"),
          ],
          promql_expr_test: [expectation(LABEL_MISSING_EXPR, "5m", undefined)],
        },
        {
          interval: "1m",
          name: "every agent has its label",
          input_series: agentFleet(FLEET),
          promql_expr_test: [expectation(LABEL_MISSING_EXPR, "5m", undefined)],
        },
        {
          // A partial export: `main` has it, `pr` does not.
          interval: "1m",
          name: "one agent lacks the label while another exports it",
          input_series: [
            capSeries("main", "4", "1x20"),
            availableSeries("main", "1x20"),
            availableSeries("pr", "1x20"),
          ],
          promql_expr_test: [
            {
              expr: LABEL_MISSING_EXPR,
              eval_time: "5m",
              exp_samples: [firing("pr")],
            },
          ],
        },
        {
          // A cap above the enumeration (64) is exported but unreadable.
          interval: "1m",
          name: "a cap beyond the 1..64 enumeration",
          input_series: [
            capSeries("main", "4", "1x20"),
            availableSeries("main", "1x20"),
            capSeries("pr", "70", "1x20"),
            availableSeries("pr", "1x20"),
          ],
          promql_expr_test: [
            {
              expr: LABEL_MISSING_EXPR,
              eval_time: "5m",
              exp_samples: [firing("pr")],
            },
          ],
        },
        {
          // The allowlist entry is removed after the labels were exported:
          // the current series are gone, the 7-day gate remembers them.
          interval: "1m",
          name: "labels disappear after having been exported",
          input_series: [
            capSeries("pr", "8", "1x2 _x17"),
            availableSeries("pr", "1x20"),
            capSeries("main", "4", "1x2 _x17"),
            availableSeries("main", "1x20"),
          ],
          promql_expr_test: [
            {
              expr: LABEL_MISSING_EXPR,
              eval_time: "15m",
              exp_samples: [firing("pr"), firing("main")],
            },
          ],
        },
        {
          // A pod that is down is not this alert's to report.
          interval: "1m",
          name: "an unavailable agent without the label",
          input_series: [
            capSeries("main", "4", "1x20"),
            availableSeries("main", "1x20"),
            availableSeries("pr", "0x20"),
          ],
          promql_expr_test: [expectation(LABEL_MISSING_EXPR, "5m", undefined)],
        },
      ],
    });
  });
});
