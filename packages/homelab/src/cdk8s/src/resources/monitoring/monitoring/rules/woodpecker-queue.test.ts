import { describe, expect, it } from "vitest";
import { CI_ADMISSION_BUDGET } from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";
import { CI_KUBE_STATE_METRICS_VALUES } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/grafana-values.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";
import {
  CI_AGENT_MAX_WORKFLOWS_KSM_LABEL,
  CI_AGENT_MAX_WORKFLOWS_LABEL_LIMIT,
  getWoodpeckerQueueAlertRules,
} from "./woodpecker-queue.ts";

const rules = getWoodpeckerQueueAlertRules();

function alert(name: string) {
  const rule = rules.find((candidate) => candidate.alert === name);
  if (rule === undefined) throw new Error(`missing alert ${name}`);
  return { rule, expr: String(rule.expr.value) };
}

type Agent = {
  pool: string;
  cap: number;
  // Sample values over time, in promtool series notation.
  available: string;
  desired?: string;
};

function agentSeries({ pool, cap, available, desired = "1x20" }: Agent) {
  const deployment = `namespace="woodpecker",deployment="woodpecker-woodpecker-agent-${pool}"`;
  return [
    capSeries(pool, String(cap), "1x20"),
    {
      series: `kube_deployment_status_replicas_available{${deployment}}`,
      values: available,
    },
    { series: `kube_deployment_spec_replicas{${deployment}}`, values: desired },
  ];
}

// A label value cannot vary over time in one series, so a cap that changes is
// two series (the old label value ending, the new one starting), which is what
// kube-state-metrics does.
function capSeries(pool: string, label: string, values: string) {
  return {
    series: `kube_deployment_labels{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-${pool}",${CI_AGENT_MAX_WORKFLOWS_KSM_LABEL}="${label}"}`,
    values,
  };
}

function agentFleet(caps: Record<string, number>, available = "1x20") {
  return Object.entries(caps).flatMap(([pool, cap]) => [
    capSeries(pool, String(cap), "1x20"),
    {
      series: `kube_deployment_status_replicas_available{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-${pool}"}`,
      values: available,
    },
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

describe("Woodpecker agent slot alerts", () => {
  it("is a warning held for 10 minutes", () => {
    for (const name of [
      "WoodpeckerAgentDisconnected",
      "WoodpeckerAgentDeploymentUnavailable",
    ]) {
      const { rule } = alert(name);
      expect(rule.for).toBe("10m");
      // `info` routes to the null receiver, which would notify nobody.
      expect(rule.labels?.["severity"]).toBe("warning");
    }
  });

  // The expected capacity is what the cluster runs. It must not come from the
  // admission budget in this source, which leads the live agents between a cap
  // change merging and its rollout.
  it("reads expected slots from live Deployment labels, not the source budget", () => {
    const { expr } = alert("WoodpeckerAgentDisconnected");
    expect(expr).toContain("kube_deployment_labels");
    expect(expr).toContain(CI_AGENT_MAX_WORKFLOWS_KSM_LABEL);
    expect(expr).not.toContain(`< ${String(CI_ADMISSION_BUDGET.maxWorkflows)}`);
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
    const { expr } = alert("WoodpeckerAgentDisconnected");
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          name: "healthy fleet",
          input_series: [...agentFleet(FLEET), ...server("9x20", "7x20")],
          promql_expr_test: [expectation(expr, "5m", undefined)],
        },
        {
          interval: "1m",
          name: "every one of the 16 slots busy",
          input_series: [...agentFleet(FLEET), ...server("0x20", "16x20")],
          promql_expr_test: [expectation(expr, "5m", undefined)],
        },
        {
          // The 8-slot `pr` agent pod is up but disconnected: 4 idle + 4
          // running of the other pools' 8 slots, against 16 configured.
          interval: "1m",
          name: "a running pool agent lost its connection",
          input_series: [...agentFleet(FLEET), ...server("4x20", "4x20")],
          promql_expr_test: [expectation(expr, "5m", 8)],
        },
        {
          // Labels not exported yet (before the agents are relabelled): no
          // expected capacity, so no page.
          interval: "1m",
          name: "no slot labels yet",
          input_series: server("9x20", "7x20"),
          promql_expr_test: [expectation(expr, "5m", undefined)],
        },
        {
          // A cap change reaches the cluster as one rollout: `main` goes 4 -> 10
          // (the Deployment label changes, the Recreate pod is unavailable for
          // two minutes, then 6 more slots connect). The source budget says 22
          // from the merge on; the expression never looks at it.
          interval: "1m",
          name: "main's cap rises from 4 to 10 mid-window",
          input_series: [
            capSeries("pr", "8", "1x24"),
            capSeries("review", "3", "1x24"),
            capSeries("completion", "1", "1x24"),
            capSeries("main", "4", "1x5 _x19"),
            capSeries("main", "10", "_x6 1x18"),
            ...["pr", "review", "completion"].map((pool) => ({
              series: `kube_deployment_status_replicas_available{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-${pool}"}`,
              values: "1x24",
            })),
            {
              series:
                'kube_deployment_status_replicas_available{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-main"}',
              values: "1x5 0x1 1x16",
            },
            // 16 slots connected, 12 while main's pod is down, then 22.
            ...server("9x5 5x1 15x16", "7x24"),
          ],
          promql_expr_test: [
            expectation(expr, "3m", undefined),
            expectation(expr, "7m", undefined),
            expectation(expr, "20m", undefined),
          ],
        },
      ],
    });
  });

  it("pages when a pool has no available agent pod, including a one-replica pool", async () => {
    const { expr } = alert("WoodpeckerAgentDeploymentUnavailable");
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          name: "a crash-looping one-replica pool",
          input_series: [
            ...agentSeries({ pool: "pr", cap: 8, available: "1x20" }),
            // The new maintenance pool: one replica wanted, none available.
            ...agentSeries({ pool: "maintenance", cap: 2, available: "0x20" }),
          ],
          promql_expr_test: [
            {
              expr,
              eval_time: "5m",
              exp_samples: [
                {
                  labels:
                    '{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-maintenance"}',
                  value: 0,
                },
              ],
            },
          ],
        },
        {
          // A kube-state-metrics restart exposes each Deployment from two
          // pods for a few minutes; that must not fail the match.
          interval: "1m",
          name: "duplicate series from two kube-state-metrics pods",
          input_series: [
            ...agentSeries({ pool: "pr", cap: 8, available: "1x20" }),
            {
              series:
                'kube_deployment_status_replicas_available{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-pr",pod="ksm-b"}',
              values: "1x20",
            },
            {
              series:
                'kube_deployment_spec_replicas{namespace="woodpecker",deployment="woodpecker-woodpecker-agent-pr",pod="ksm-b"}',
              values: "1x20",
            },
          ],
          promql_expr_test: [expectation(expr, "5m", undefined)],
        },
        {
          interval: "1m",
          name: "all agents available, or scaled to zero on purpose",
          input_series: [
            ...agentSeries({ pool: "pr", cap: 8, available: "1x20" }),
            ...agentSeries({
              pool: "review",
              cap: 3,
              available: "0x20",
              desired: "0x20",
            }),
          ],
          promql_expr_test: [expectation(expr, "5m", undefined)],
        },
      ],
    });
  });

  it("pages for the pool that lost its agent, and only through the Deployment alert", async () => {
    const disconnected = alert("WoodpeckerAgentDisconnected").expr;
    const unavailable = alert("WoodpeckerAgentDeploymentUnavailable").expr;
    // `pr` (8 slots) crash-loops: its slots leave the expected total with it,
    // so the slot comparison stays quiet at 8 of 8 and the Deployment alert
    // carries the page.
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          name: "pr agent unavailable",
          input_series: [
            ...agentSeries({ pool: "pr", cap: 8, available: "0x20" }),
            ...agentSeries({ pool: "main", cap: 4, available: "1x20" }),
            ...server("4x20", "4x20"),
          ],
          promql_expr_test: [
            expectation(disconnected, "5m", undefined),
            {
              expr: `count(${unavailable})`,
              eval_time: "5m",
              exp_samples: [{ labels: "{}", value: 1 }],
            },
          ],
        },
      ],
    });
  });
});
