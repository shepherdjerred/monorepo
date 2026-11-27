import type { PrometheusRuleSpecGroupsRules } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { CI_ADMISSION_BUDGET } from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * Workflow slots across every agent: the most steps Woodpecker can run at
 * once, from the admission budget. The server's `woodpecker_worker_count` is
 * the number of those slots idling in the queue, so `worker_count +
 * running_steps` equals this number while every agent is connected (98.7% of
 * the last 7 days).
 */
export const CI_AGENT_WORKFLOW_SLOTS = CI_ADMISSION_BUDGET.maxWorkflows;

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
      // steps equals the total slots while every agent is connected, and falls
      // short by a pool's slots when one pool's agent drops out. Zero idle
      // slots alone is not a fault: a fully busy fleet reports zero.
      //
      // 14-day backtest: one episode, 2026-11-13 19:20Z to 11-14 01:55Z, when
      // no agent was connected at all; no false episodes. `warning`, because
      // `info` routes to the null receiver.
      alert: "WoodpeckerAgentDisconnected",
      annotations: {
        summary:
          "Woodpecker CI has fewer agent slots connected than configured",
        description: escapePrometheusTemplate(
          `The Woodpecker server counts {{ $value }} agent slots (idle plus running), fewer than the ${String(CI_AGENT_WORKFLOW_SLOTS)} the agent pools provide, for 10 minutes, so at least one pool's agent has lost its connection and CI pipelines for that pool are stuck in queue. Check the woodpecker-agent pools and woodpecker-server logs for gRPC connectivity or authentication errors.`,
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        `max(woodpecker_worker_count{namespace="woodpecker"}) + on () max(woodpecker_running_steps{namespace="woodpecker"}) < ${String(CI_AGENT_WORKFLOW_SLOTS)}`,
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
