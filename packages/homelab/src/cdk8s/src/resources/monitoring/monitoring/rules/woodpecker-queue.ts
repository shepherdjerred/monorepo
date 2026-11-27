import type { PrometheusRuleSpecGroupsRules } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { CI_AGENT_MAX_WORKFLOWS_LABEL } from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";
import { escapePrometheusTemplate } from "./shared.ts";

const AGENT_DEPLOYMENTS = `namespace="woodpecker",deployment=~"woodpecker-woodpecker-agent-.+"`;

/** kube-state-metrics' spelling of CI_AGENT_MAX_WORKFLOWS_LABEL. */
export const CI_AGENT_MAX_WORKFLOWS_KSM_LABEL = `label_${CI_AGENT_MAX_WORKFLOWS_LABEL.replaceAll(/[./-]/gu, "_")}`;

/**
 * The most slots one agent's label can declare. PromQL cannot turn a label
 * value into a number, so the rule enumerates `1..N` and weights each series
 * by the value it matched; an agent configured above this is not counted.
 */
export const CI_AGENT_MAX_WORKFLOWS_LABEL_LIMIT = 64;

/**
 * Slots the cluster is configured to run right now: each agent Deployment's
 * `ci.sjer.red/max-workflows` label times its available replicas. This is live
 * state, so it follows a cap change only when the agent rollout lands, which
 * is when the server's `woodpecker_worker_count` follows too. A series-free
 * result (labels not yet exported) leaves the alert quiet rather than paging.
 */
export function configuredAgentSlots(): string {
  const perValue = Array.from(
    { length: CI_AGENT_MAX_WORKFLOWS_LABEL_LIMIT },
    (_, index) => {
      const slots = String(index + 1);
      return `${slots} * kube_deployment_labels{${AGENT_DEPLOYMENTS},${CI_AGENT_MAX_WORKFLOWS_KSM_LABEL}="${slots}"}`;
    },
  );
  // `max by` keeps one series per Deployment if a label change leaves the old
  // value visible for a moment beside the new one.
  return `sum(
  max by (namespace, deployment) (
    ${perValue.join("\n    or ")}
  )
  * on (namespace, deployment)
  max by (namespace, deployment) (
    kube_deployment_status_replicas_available{${AGENT_DEPLOYMENTS}}
  )
)`;
}

/**
 * Pending-queue alert thresholds, chosen from the 14 days to 2026-11-26.
 *
 * `woodpecker_pending_steps` (steps queued for an agent slot): p50 0, p75 3,
 * p90 56, p99 265, max 329. `liskov` CPU busy: p50 0.6%, p90 61%, p99 83%.
 * More than 20 steps were pending 15% of the time, and 10% of the time with
 * the node under 60% busy. 20 steps is more than two full `pr` pools of work
 * (8 slots each), and 60% busy leaves 11 of the node's 29 cores free, enough
 * for another verify (6.6 cores on average).
 *
 * This is a known problem the CI program is fixing, so the alert only guards
 * against a sustained regression: held for 30 minutes it fired 20 times in the
 * 14-day backtest (a warning email every day or so); held for 2 hours it fires
 * once.
 */
export const CI_PENDING_STEPS_THRESHOLD = 20;
export const CI_NODE_CPU_HEADROOM_IDLE_RATIO = 0.4;
export const CI_PENDING_QUEUE_FOR = "2h";

const CI_NODE_BUSY_PERCENT = Math.round(
  (1 - CI_NODE_CPU_HEADROOM_IDLE_RATIO) * 100,
);

/**
 * Alerts on the Woodpecker server's own queue, upstream of Kueue.
 */
export function getWoodpeckerQueueAlertRules(): PrometheusRuleSpecGroupsRules[] {
  return [
    {
      // `woodpecker_worker_count` counts idle agent slots, so idle plus running
      // steps equals the slots of every connected agent, and falls short by a
      // pool's slots when that pool's agent is running but disconnected. Zero
      // idle slots alone is not a fault: a fully busy fleet reports zero.
      //
      // The expected total is the live configured slots of the available
      // agents (see configuredAgentSlots), never the admission budget in this
      // source: the two differ between a cap change merging and its agent
      // rollout, and would page for that whole window.
      //
      // `warning`, because `info` routes to the null receiver.
      alert: "WoodpeckerAgentDisconnected",
      annotations: {
        summary:
          "Woodpecker CI has fewer agent slots connected than configured",
        description: escapePrometheusTemplate(
          `The Woodpecker server counts {{ $value }} agent slots (idle plus running) for 10 minutes, fewer than the available agents are configured to run, so at least one agent is running but has lost its connection and CI pipelines for its pool are stuck in queue. Check the woodpecker-agent pools and woodpecker-server logs for gRPC connectivity or authentication errors.`,
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        `max(woodpecker_worker_count{namespace="woodpecker"}) + on () max(woodpecker_running_steps{namespace="woodpecker"})
< on ()
${configuredAgentSlots()}`,
      ),
      for: "10m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "woodpecker",
      },
    },
    {
      // A pool whose agent pod is not available (crash-looping, unschedulable)
      // has no connection to compare, so the slot count above cannot see it:
      // its slots drop out of the expected total too. This is the simpler
      // check for that case, and it covers a one-replica pool such as a new
      // agent that never comes up.
      alert: "WoodpeckerAgentDeploymentUnavailable",
      annotations: {
        summary: "A Woodpecker CI agent has no available pod",
        description:
          "A Woodpecker agent Deployment has had fewer available replicas than it asks for during 10 minutes, so its pool cannot run CI work. Check the agent pod in the woodpecker namespace for crash loops, failed scheduling on the CI node, or image pull errors.",
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        // `max by` on both sides: a kube-state-metrics restart briefly exposes
        // each Deployment from two pods, which would fail the match.
        `max by (namespace, deployment) (kube_deployment_status_replicas_available{${AGENT_DEPLOYMENTS}})
< on (namespace, deployment)
max by (namespace, deployment) (kube_deployment_spec_replicas{${AGENT_DEPLOYMENTS}})`,
      ),
      for: "10m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "woodpecker",
      },
    },
    {
      // Steps wait in Woodpecker's own queue for an agent slot before Kueue
      // ever sees them (Kueue's wait has its own panels). Many queued steps
      // while liskov is far from busy is not saturation: the slots are held by
      // workflows that are admitted but gated. This alert is that signature.
      // Thresholds come from 14 days of data; see CI_PENDING_STEPS_THRESHOLD.
      // The 2h `for` makes it a guard against a sustained regression of a
      // known problem, not a daily email.
      alert: "WoodpeckerPendingQueueWithCpuHeadroom",
      annotations: {
        summary: "CI steps are queued for an agent while liskov has spare CPU",
        description: escapePrometheusTemplate(
          `{{ $value | printf "%.0f" }} Woodpecker steps have waited for an agent slot for ${CI_PENDING_QUEUE_FOR} while the CI node is under ${String(CI_NODE_BUSY_PERCENT)}% busy, so ready pull requests wait on admission bookkeeping rather than on compute. Compare the Woodpecker queue panels with the Kueue admission panels on the CI capacity dashboard, and check whether workflows are holding agent slots while gated.`,
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`max(woodpecker_pending_steps{namespace="woodpecker"}) > ${String(CI_PENDING_STEPS_THRESHOLD)}
and on ()
  avg(rate(node_cpu_seconds_total{node="${CI_NODE_HOSTNAME}",mode="idle"}[5m])) > ${String(CI_NODE_CPU_HEADROOM_IDLE_RATIO)}`),
      for: CI_PENDING_QUEUE_FOR,
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "woodpecker",
      },
    },
  ];
}
