import { exportDashboardWithHelmEscaping } from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-export.ts";
import {
  statPanel,
  target,
  timeseriesPanel,
} from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-panels.ts";
import {
  BREAK_GLASS_ACTIVE_EXPR,
  ENFORCER_CONTAINER,
  ENFORCER_DAEMONSET,
  ENFORCER_NAMESPACE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/platform/network-policy-enforcement.ts";

/**
 * Watches the kube-network-policies enforcer (v1.1.2, the version Talos 1.14
 * pins) before and after NetworkPolicy enforcement is switched on.
 *
 * Its metrics carry no namespace or policy: `kube_network_policies_packet_count`
 * is labelled only by protocol, family and verdict. Its `--v=2` log is the
 * only per-namespace signal, and at v1.1.2 the denial line itself names just
 * the packet id (pkg/networkpolicy/engine.go). The `Evaluating packet` line
 * with the same id, logged by pkg/networkpolicy/logging.go just before it,
 * names the source and destination pods. LogQL cannot join the two, so the
 * per-namespace view is the log panel; only deny-all policies name
 * themselves in a counted line.
 */

const LOKI_DATASOURCE = { type: "loki", uid: "loki" };
const ENFORCER_LOG_STREAM = `{namespace="${ENFORCER_NAMESPACE}", container="${ENFORCER_CONTAINER}"}`;
const ENFORCER_CONTAINER_SELECTOR = `namespace="${ENFORCER_NAMESPACE}", pod=~"${ENFORCER_DAEMONSET}-.*", container="${ENFORCER_CONTAINER}"`;
const WITH_NODE = `* on (namespace, pod) group_left (node) max by (namespace, pod, node) (kube_pod_info{namespace="${ENFORCER_NAMESPACE}"})`;

/** klog text lines from pkg/networkpolicy at v1.1.2, matched by LogQL. */
export const DENIED_PACKETS_BY_NODE = `sum by (node_name, direction) (count_over_time(${ENFORCER_LOG_STREAM} |= "Packet denied by" | regexp \`Packet denied by (?P<direction>egress|ingress) policy\` [$__auto]))`;
export const DENY_ALL_MATCHES_BY_POLICY = `sum by (policy_namespace, policy, direction) (count_over_time(${ENFORCER_LOG_STREAM} |= "Pod has limited all" | regexp \`Pod has limited all (?P<direction>egress|ingress) traffic".* policy="(?P<policy_namespace>[^"/]+)/(?P<policy>[^"]+)"\` [$__auto]))`;
export const ENFORCER_ERRORS_BY_NODE = `sum by (node_name) (count_over_time(${ENFORCER_LOG_STREAM} |~ "^E[0-9]{4} " [$__auto]))`;
export const DENIAL_CONTEXT_LOG = `${ENFORCER_LOG_STREAM} |~ "Packet denied by|Evaluating packet|Pod has limited all|^E[0-9]{4} "`;

type Thresholds = { color: string; value: number | null }[];

const ZERO_IS_GOOD: Thresholds = [
  { color: "green", value: null },
  { color: "red", value: 1 },
];

function withThresholds<
  Panel extends { fieldConfig: { defaults: Record<string, unknown> } },
>(panel: Panel, steps: Thresholds): Panel {
  return {
    ...panel,
    fieldConfig: {
      ...panel.fieldConfig,
      defaults: {
        ...panel.fieldConfig.defaults,
        thresholds: { mode: "absolute", steps },
      },
    },
  };
}

function lokiTimeseriesPanel(input: {
  id: number;
  title: string;
  description: string;
  expr: string;
  legend: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  return {
    ...timeseriesPanel({ ...input, targets: [] }),
    datasource: LOKI_DATASOURCE,
    targets: [
      {
        datasource: LOKI_DATASOURCE,
        editorMode: "code",
        expr: input.expr,
        legendFormat: input.legend,
        queryType: "range",
        refId: "A",
      },
    ],
  };
}

function healthPanels() {
  return [
    statPanel({
      id: 1,
      title: "Enforcers running",
      description:
        "kube-network-policies containers running in kube-system/kube-flannel. Zero before enforcement is switched on. The enforcer fails open: a node without a running one passes all traffic.",
      expr: `sum(kube_pod_container_status_running{${ENFORCER_CONTAINER_SELECTOR}}) or on() vector(0)`,
      legend: "running",
      x: 0,
      y: 0,
      w: 6,
      h: 4,
    }),
    statPanel({
      id: 2,
      title: "Nodes the DaemonSet covers",
      description:
        "Desired pods of kube-system/kube-flannel. Enforcers running should equal this once enforcement is on.",
      expr: `max(kube_daemonset_status_desired_number_scheduled{namespace="${ENFORCER_NAMESPACE}", daemonset="${ENFORCER_DAEMONSET}"})`,
      legend: "nodes",
      x: 6,
      y: 0,
      w: 6,
      h: 4,
    }),
    withThresholds(
      statPanel({
        id: 3,
        title: "Enforcer restarts in range",
        description:
          "Each restart is a window in which that node enforced nothing.",
        expr: `sum(increase(kube_pod_container_status_restarts_total{${ENFORCER_CONTAINER_SELECTOR}}[$__range])) or on() vector(0)`,
        legend: "restarts",
        x: 12,
        y: 0,
        w: 6,
        h: 4,
      }),
      ZERO_IS_GOOD,
    ),
    withThresholds(
      statPanel({
        id: 4,
        title: "Break-glass policies",
        description:
          "enforcement-break-glass-* policies that hold a namespace open outside source. See the break-glass table below.",
        expr: `count(${BREAK_GLASS_ACTIVE_EXPR}) or on() vector(0)`,
        legend: "policies",
        x: 18,
        y: 0,
        w: 6,
        h: 4,
      }),
      ZERO_IS_GOOD,
    ),
    timeseriesPanel({
      id: 5,
      title: "Enforcer running and restarts by node",
      description:
        "1 while the node's enforcer container runs; restarts per interval beside it.",
      targets: [
        {
          expr: `max by (node) (kube_pod_container_status_running{${ENFORCER_CONTAINER_SELECTOR}} ${WITH_NODE})`,
          legend: "running {{node}}",
        },
        {
          expr: `sum by (node) (increase(kube_pod_container_status_restarts_total{${ENFORCER_CONTAINER_SELECTOR}}[$__rate_interval]) ${WITH_NODE})`,
          legend: "restarts {{node}}",
        },
      ],
      x: 0,
      y: 4,
      w: 12,
      h: 8,
    }),
    timeseriesPanel({
      id: 6,
      title: "Packet verdicts by node",
      description:
        "kube_network_policies_packet_count by verdict (accept, drop). Only packets of new connections to or from pods some policy selects reach the enforcer. The metric has no namespace or policy label.",
      targets: [
        {
          expr: "sum by (node, verdict) (rate(kube_network_policies_packet_count[$__rate_interval]))",
          legend: "{{node}} {{verdict}}",
        },
      ],
      x: 12,
      y: 4,
      w: 12,
      h: 8,
      unit: "pps",
    }),
    timeseriesPanel({
      id: 7,
      title: "Decision latency p99",
      description:
        "kube_network_policies_packet_process_time, the time from queueing a packet to its verdict. Every queued packet waits for it.",
      targets: [
        {
          expr: "histogram_quantile(0.99, sum by (node, le) (rate(kube_network_policies_packet_process_time_bucket[$__rate_interval])))",
          legend: "{{node}}",
        },
      ],
      x: 0,
      y: 12,
      w: 12,
      h: 8,
      unit: "µs",
    }),
    timeseriesPanel({
      id: 8,
      title: "nfqueue backlog and kernel drops",
      description:
        "From /proc/net/netfilter/nfnetlink_queue. Drops mean packets the enforcer never decided on.",
      targets: [
        {
          expr: "max by (node) (kube_network_policies_nfqueue_queue_total)",
          legend: "queued {{node}}",
        },
        {
          expr: "sum by (node) (delta(kube_network_policies_nfqueue_queue_dropped[$__rate_interval]))",
          legend: "queue full {{node}}",
        },
        {
          expr: "sum by (node) (delta(kube_network_policies_nfqueue_user_dropped[$__rate_interval]))",
          legend: "netlink dropped {{node}}",
        },
      ],
      x: 12,
      y: 12,
      w: 12,
      h: 8,
    }),
  ];
}

function denialPanels() {
  return [
    lokiTimeseriesPanel({
      id: 9,
      title: "Denied packets by node and direction",
      description:
        "Count of `Packet denied by egress|ingress policy` lines. v1.1.2 logs no namespace or policy on this line; find its pods in the log panel below by the same id. Upstream #440: a closing packet of a connection that predates the enforcer is also logged as denied.",
      expr: DENIED_PACKETS_BY_NODE,
      legend: "{{node_name}} {{direction}}",
      x: 0,
      y: 20,
      w: 12,
      h: 8,
    }),
    lokiTimeseriesPanel({
      id: 10,
      title: "Deny-all policy matches by namespace and policy",
      description:
        "`Pod has limited all egress|ingress traffic` lines: a policy with no rules in that direction selected the pod. This is the only line that names a policy. Another policy selecting the same pod can still allow the packet.",
      expr: DENY_ALL_MATCHES_BY_POLICY,
      legend: "{{policy_namespace}}/{{policy}} {{direction}}",
      x: 12,
      y: 20,
      w: 12,
      h: 8,
    }),
    {
      id: 11,
      type: "logs",
      title: "Denials with their packets",
      description:
        "Denial lines beside the `Evaluating packet` line of each packet. Match a denial to its packet by id= and pod: srcPod is the namespace that needs an egress rule, dstPod the one that needs an ingress rule. `external` is a non-pod address.",
      datasource: LOKI_DATASOURCE,
      gridPos: { x: 0, y: 28, w: 18, h: 12 },
      options: {
        showTime: true,
        showLabels: true,
        showCommonLabels: false,
        wrapLogMessage: true,
        enableLogDetails: true,
        dedupStrategy: "none",
        sortOrder: "Descending",
      },
      targets: [
        {
          datasource: LOKI_DATASOURCE,
          editorMode: "code",
          expr: DENIAL_CONTEXT_LOG,
          maxLines: 1000,
          queryType: "range",
          refId: "A",
        },
      ],
    },
    lokiTimeseriesPanel({
      id: 12,
      title: "Enforcer errors by node",
      description:
        "klog error lines, including `Can not process packet, applying default policy`.",
      expr: ENFORCER_ERRORS_BY_NODE,
      legend: "{{node_name}}",
      x: 18,
      y: 28,
      w: 6,
      h: 12,
    }),
  ];
}

function breakGlassPanel() {
  return {
    id: 13,
    type: "table",
    title: "Break-glass policies",
    description:
      "Every enforcement-break-glass-* NetworkPolicy, from kube-state-metrics. Each one holds its namespace open until it is closed; see Open a namespace in an emergency.",
    datasource: { type: "prometheus", uid: "Prometheus" },
    gridPos: { x: 0, y: 40, w: 24, h: 6 },
    fieldConfig: {
      defaults: {},
      overrides: [
        {
          matcher: { id: "byName", options: "Created" },
          properties: [{ id: "unit", value: "dateTimeAsIso" }],
        },
      ],
    },
    options: { showHeader: true },
    targets: [
      {
        ...target(`${BREAK_GLASS_ACTIVE_EXPR} * 1000`, ""),
        format: "table",
        instant: true,
        range: false,
      },
    ],
    transformations: [
      {
        id: "organize",
        options: {
          includeByName: { namespace: true, networkpolicy: true, Value: true },
          renameByName: {
            namespace: "Namespace",
            networkpolicy: "Policy",
            Value: "Created",
          },
        },
      },
    ],
  };
}

export function createNetworkPolicyEnforcementDashboard() {
  return {
    uid: "network-policy-enforcement",
    title: "NetworkPolicy enforcement",
    tags: ["network-policy", "kube-network-policies", "platform"],
    timezone: "browser",
    schemaVersion: 40,
    version: 1,
    refresh: "1m",
    time: { from: "now-6h", to: "now" },
    panels: [...healthPanels(), ...denialPanels(), breakGlassPanel()],
  };
}

export function exportNetworkPolicyEnforcementDashboardJson(): string {
  return exportDashboardWithHelmEscaping(
    createNetworkPolicyEnforcementDashboard(),
  );
}
