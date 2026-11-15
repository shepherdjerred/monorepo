import { expect, test } from "vitest";
import {
  BREAK_GLASS_ACTIVE_EXPR,
  ENFORCER_NOT_RUNNING_EXPR,
  ENFORCER_RESTARTED_EXPR,
  getNetworkPolicyEnforcementRuleGroups,
} from "./network-policy-enforcement.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";

const DESIRED = {
  series:
    'kube_daemonset_status_desired_number_scheduled{namespace="kube-system",daemonset="kube-flannel"}',
  values: "2x20",
};

function flannelContainer(pod: string, container: string, running: number) {
  const labels = `namespace="kube-system",pod="${pod}",container="${container}"`;
  return [
    { series: `kube_pod_container_info{${labels}}`, values: "1x20" },
    {
      series: `kube_pod_container_status_running{${labels}}`,
      values: `${String(running)}x20`,
    },
  ];
}

const FLANNEL_ONLY = [
  ...flannelContainer("kube-flannel-a", "kube-flannel", 1),
  ...flannelContainer("kube-flannel-b", "kube-flannel", 1),
];

function notRunningCase(
  series: { series: string; values: string }[],
  exp: { value: number }[],
) {
  return {
    interval: "1m",
    input_series: [DESIRED, ...series],
    promql_expr_test: [
      {
        expr: ENFORCER_NOT_RUNNING_EXPR,
        eval_time: "10m",
        exp_samples: exp.map(({ value }) => ({
          labels: '{namespace="kube-system"}',
          value,
        })),
      },
    ],
  };
}

test("every rule carries a severity and an explanation", () => {
  const rules = getNetworkPolicyEnforcementRuleGroups().flatMap(
    (group) => group.rules ?? [],
  );
  expect(rules.map((rule) => rule.alert)).toEqual([
    "NetworkPolicyEnforcerNotRunning",
    "NetworkPolicyEnforcerRestarted",
    "NetworkPolicyBreakGlassActive",
  ]);
  for (const rule of rules) {
    expect(rule.labels?.["severity"]).toMatch(/^(warning|critical)$/);
    expect(rule.annotations?.["description"]?.length ?? 0).toBeGreaterThan(0);
  }
});

test("the enforcer alert is silent without the container and fires on a missing or stopped one", async () => {
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      // Today: flannel runs alone and the enforcer container does not exist.
      notRunningCase(FLANNEL_ONLY, []),
      notRunningCase(
        [
          ...FLANNEL_ONLY,
          ...flannelContainer("kube-flannel-a", "kube-network-policies", 1),
          ...flannelContainer("kube-flannel-b", "kube-network-policies", 1),
        ],
        [],
      ),
      // One enforcer crash-looping.
      notRunningCase(
        [
          ...FLANNEL_ONLY,
          ...flannelContainer("kube-flannel-a", "kube-network-policies", 1),
          ...flannelContainer("kube-flannel-b", "kube-network-policies", 0),
        ],
        [{ value: 1 }],
      ),
      // One node's flannel pod missing entirely.
      notRunningCase(
        [
          ...flannelContainer("kube-flannel-a", "kube-flannel", 1),
          ...flannelContainer("kube-flannel-a", "kube-network-policies", 1),
        ],
        [{ value: 1 }],
      ),
      // Every enforcer stopped.
      notRunningCase(
        [
          ...FLANNEL_ONLY,
          ...flannelContainer("kube-flannel-a", "kube-network-policies", 0),
          ...flannelContainer("kube-flannel-b", "kube-network-policies", 0),
        ],
        [{ value: 2 }],
      ),
    ],
  });
});

test("a restart fires with the node, and a steady count does not", async () => {
  const labels =
    'namespace="kube-system",pod="kube-flannel-a",container="kube-network-policies"';
  const podInfo = {
    series:
      'kube_pod_info{namespace="kube-system",pod="kube-flannel-a",node="torvalds",host_ip="192.0.2.1"}',
    values: "1x40",
  };
  const restartCase = (values: string, exp: { value: number }[]) => ({
    interval: "1m",
    input_series: [
      podInfo,
      {
        series: `kube_pod_container_status_restarts_total{${labels}}`,
        values,
      },
    ],
    promql_expr_test: [
      {
        expr: ENFORCER_RESTARTED_EXPR,
        eval_time: "30m",
        exp_samples: exp.map(({ value }) => ({
          labels: `{${labels},node="torvalds"}`,
          value,
        })),
      },
    ],
  });
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      restartCase("0x40", []),
      // One restart at minute 25, inside the 15-minute window.
      restartCase("0x25 1x15", [{ value: 1 }]),
    ],
  });
});

function policy(namespace: string, name: string) {
  return {
    series: `kube_networkpolicy_created{namespace="${namespace}",networkpolicy="${name}"}`,
    values: "1700000000x10",
  };
}

test("the break-glass alert matches only break-glass policies", async () => {
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: [
      {
        interval: "1m",
        input_series: [
          policy("tracker", "enforcement-staging-tracker"),
          policy("tracker", "tracker-app-netpol"),
        ],
        promql_expr_test: [
          { expr: BREAK_GLASS_ACTIVE_EXPR, eval_time: "5m", exp_samples: [] },
        ],
      },
      {
        interval: "1m",
        input_series: [
          policy("tracker", "enforcement-staging-tracker"),
          policy("tracker", "enforcement-break-glass-tracker"),
        ],
        promql_expr_test: [
          {
            expr: BREAK_GLASS_ACTIVE_EXPR,
            eval_time: "5m",
            exp_samples: [
              {
                labels:
                  '{__name__="kube_networkpolicy_created",namespace="tracker",networkpolicy="enforcement-break-glass-tracker"}',
                value: 1_700_000_000,
              },
            ],
          },
        ],
      },
    ],
  });
});
