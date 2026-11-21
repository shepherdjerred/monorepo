import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

/**
 * The NetworkPolicy enforcer is the `kube-network-policies` container that
 * Talos adds to the `kube-system/kube-flannel` DaemonSet when
 * `kubeNetworkPoliciesEnabled` is set. It is fail-open: when the container is
 * not running, every packet passes unenforced and nothing else notices.
 *
 * Every expression here selects that container by name, so it matches nothing
 * until the switch adds it. See
 * packages/docs/wiki/src/content/docs/explanation/homelab/network-policy-enforcement.md.
 */
export const ENFORCER_NAMESPACE = "kube-system";
export const ENFORCER_DAEMONSET = "kube-flannel";
export const ENFORCER_CONTAINER = "kube-network-policies";
export const ENFORCER_POD_SELECTOR = { "k8s-app": "flannel", tier: "node" };
/** Upstream default `--metrics-bind-address` (pkg/cmd/cmd.go at v1.1.2). */
export const ENFORCER_METRICS_PORT = 9080;
/** Prefix written by `bun run netpol:open` (scripts/network-policy/break-glass.ts). */
export const BREAK_GLASS_POLICY_PREFIX = "enforcement-break-glass-";

const ENFORCER_CONTAINER_SELECTOR = `namespace="${ENFORCER_NAMESPACE}", pod=~"${ENFORCER_DAEMONSET}-.*", container="${ENFORCER_CONTAINER}"`;
const DAEMONSET_DESIRED = `max by (namespace) (kube_daemonset_status_desired_number_scheduled{namespace="${ENFORCER_NAMESPACE}", daemonset="${ENFORCER_DAEMONSET}"})`;

/**
 * Nodes the DaemonSet should cover minus enforcer containers running. A pod
 * that is missing entirely counts as not running, which a per-container
 * `running == 0` check would miss. The `and` guard keeps the rule silent until
 * some flannel pod declares the enforcer container.
 */
export const ENFORCER_NOT_RUNNING_EXPR = [
  `(`,
  `  ${DAEMONSET_DESIRED}`,
  `  - on (namespace)`,
  `  (`,
  `    sum by (namespace) (kube_pod_container_status_running{${ENFORCER_CONTAINER_SELECTOR}})`,
  `    or on (namespace)`,
  `    ${DAEMONSET_DESIRED} * 0`,
  `  )`,
  `) > 0`,
  `and on (namespace)`,
  `count by (namespace) (kube_pod_container_info{${ENFORCER_CONTAINER_SELECTOR}})`,
].join("\n");

export const ENFORCER_RESTARTED_EXPR = [
  `(increase(kube_pod_container_status_restarts_total{${ENFORCER_CONTAINER_SELECTOR}}[15m]) > 0)`,
  `* on (namespace, pod) group_left (node)`,
  `max by (namespace, pod, node) (kube_pod_info{namespace="${ENFORCER_NAMESPACE}"})`,
].join("\n");

/**
 * kube-state-metrics already runs its `networkpolicies` collector here and
 * emits one `kube_networkpolicy_created` series per policy, labelled with its
 * name. The break-glass label is not exported (no `metricLabelsAllowlist`
 * entry), and is not needed: the script only creates or deletes a policy that
 * carries both the prefix and the label.
 */
export const BREAK_GLASS_ACTIVE_EXPR = `kube_networkpolicy_created{networkpolicy=~"${BREAK_GLASS_POLICY_PREFIX}.+"}`;

export function getNetworkPolicyEnforcementRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "network-policy-enforcement",
      rules: [
        {
          alert: "NetworkPolicyEnforcerNotRunning",
          annotations: {
            summary: "NetworkPolicies are not enforced on every node",
            description: escapePrometheusTemplate(
              "{{ $value }} node(s) have no running kube-network-policies container in " +
                "kube-system/kube-flannel. The enforcer fails open, so pods on those nodes " +
                "pass all traffic regardless of policy. Check the pod with " +
                "`kubectl -n kube-system get pods -l k8s-app=flannel -o wide` and its " +
                "`kube-network-policies` container log.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            ENFORCER_NOT_RUNNING_EXPR,
          ),
          for: "5m",
          labels: { severity: "critical", category: "network-policy" },
        },
        {
          alert: "NetworkPolicyEnforcerRestarted",
          annotations: {
            summary: "The NetworkPolicy enforcer restarted",
            description: escapePrometheusTemplate(
              "kube-network-policies in {{ $labels.pod }} on {{ $labels.node }} restarted " +
                "{{ $value | humanize }} time(s) in 15 minutes, allowing traffic to pass unenforced while it was " +
                "down. Read the previous container log with `kubectl -n kube-system logs " +
                "{{ $labels.pod }} -c kube-network-policies --previous`.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            ENFORCER_RESTARTED_EXPR,
          ),
          for: "0m",
          labels: { severity: "warning", category: "network-policy" },
        },
        {
          alert: "NetworkPolicyBreakGlassActive",
          annotations: {
            summary: "A namespace is held open by a break-glass policy",
            description: escapePrometheusTemplate(
              "{{ $labels.namespace }}/{{ $labels.networkpolicy }} allows all traffic and " +
                "overrides the stage of its namespace in source. Set the stage entry back to open, " +
                "let it sync, then close the policy as described in " +
                "packages/docs/wiki/src/content/docs/how-to/open-a-namespace-in-an-emergency.md.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            BREAK_GLASS_ACTIVE_EXPR,
          ),
          for: "5m",
          labels: { severity: "warning", category: "network-policy" },
        },
      ],
    },
  ];
}
