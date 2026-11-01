import type { Chart } from "cdk8s";
import {
  PrometheusRule,
  PrometheusRuleSpecGroupsRulesExpr,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";

const expr = (expression: string) =>
  PrometheusRuleSpecGroupsRulesExpr.fromString(expression);

const DELIVERY_TARGET = 'namespace="delivery",service="delivery"';
const STALLED_DISPATCH_RUNBOOK =
  "https://github.com/shepherdjerred/monorepo/blob/main/packages/docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md#respond-to-a-stalled-delivery-dispatch";

/**
 * A queued deployment that has waited this long has outwaited any single
 * legitimate holder. The longest bounded Delivery activity is the control
 * plane's (150 minutes schedule-to-close, packages/temporal/src/workflows/delivery.ts),
 * and self-hosted deployments serialize behind one such holder at a time (D8).
 */
export const DELIVERY_QUEUE_STALL_SECONDS = 3 * 60 * 60;

/** Only rendered with an activated service, so absent bootstrap targets do not alert. */
/**
 * Delivery's post-acceptance monitor (model 4.19) raised an alarm: a firing
 * alert matched the accepted deployment's monitor. Under the `automatic`
 * policy Delivery has already queued a rollback; under `hold` it waits.
 */
const DELIVERY_MONITOR_ALARMED = {
  alert: "DeliveryMonitorAlarmed",
  expr: expr(
    `max by (environment) (delivery_monitor_state{${DELIVERY_TARGET},state="alarmed"}) > 0`,
  ),
  for: "1m",
  labels: { severity: "warning" },
  annotations: {
    summary: "A Delivery monitor saw its accepted deployment alarm",
    message: escapePrometheusTemplate(
      "Delivery's monitor for {{ $labels.environment }} recorded a firing alarm against the accepted deployment. Under the automatic policy a rollback to the last settled selection is queued; under hold, decide in the Delivery hub.",
    ),
  },
};

/** The Delivery control plane's alerts; the monitor alarm loads with transition rendering. */
export function deliveryAlertRules(transition: boolean) {
  return [
    {
      alert: "DeliveryUnavailable",
      expr: expr(
        `(up{${DELIVERY_TARGET}} == 0) or absent(up{${DELIVERY_TARGET}})`,
      ),
      for: "5m",
      labels: { severity: "warning" },
      annotations: {
        summary: "Delivery control plane is unavailable",
        message:
          "The database-backed Delivery metrics endpoint is not scraping. Existing workloads may still be healthy; inspect the control plane and use its independent recovery procedure.",
      },
    },
    {
      alert: "DeliveryDispatchDelayed",
      expr: expr(`delivery_outbox_oldest_seconds{${DELIVERY_TARGET}} > 600`),
      for: "5m",
      labels: { severity: "warning" },
      annotations: {
        summary: "Delivery submissions are not reaching Temporal",
        message:
          "A nonterminal deployment has awaited durable Workflow submission acknowledgement for more than ten minutes. Inspect the dispatch Schedule, executor and outbox before retrying.",
      },
    },
    {
      // One alert per held target: recovery-required never clears itself, so
      // a short hold is already evidence, and a new holder opens a new alert
      // even while an older one is still firing.
      alert: "DeliveryRecoveryRequired",
      expr: expr(
        `max by (environment, service_id, self_hosted) (delivery_recovery_required_deployments{${DELIVERY_TARGET}}) > 0`,
      ),
      for: "5m",
      labels: { severity: "warning" },
      annotations: {
        summary: escapePrometheusTemplate(
          "{{ $labels.environment }} requires recovery and holds the Delivery dispatch barrier",
        ),
        message: escapePrometheusTemplate(
          'A deployment of {{ $labels.environment }} (service {{ $labels.service_id }}) ended recovery-required and keeps its locks. {{ if eq $labels.self_hosted "true" }}It is self-hosted, so it holds the global dispatch barrier (D8): every claim answers BUSY, and queued deployments stay queued until a newer set revision supersedes them.{{ else }}The dispatch barrier (D8) waits for it to settle, so no self-hosted deployment (delivery, delivery-control-plane, temporal, argocd) can start.{{ end }} Find its ID with `toolkit deploy status --json` (recoveryRequired). For an argo deployment, open an intent with `toolkit deploy recover <DEPLOYMENT_ID> --expected-generation <N> --reason <why> --machine`, then settle it with the same `--request-id` and `--operation-id <ARGO_OPERATION_UUID>`. For a worker deployment use `toolkit deploy workers recover <DEPLOYMENT_ID> --machine --expected-generation <N> --reason <why>`. Never delete the lock row.',
        ),
        runbook_url: STALLED_DISPATCH_RUNBOOK,
      },
    },
    {
      alert: "DeliveryQueueStalled",
      expr: expr(
        `max by (environment) (delivery_queued_oldest_seconds{${DELIVERY_TARGET}}) > ${String(DELIVERY_QUEUE_STALL_SECONDS)}`,
      ),
      for: "10m",
      labels: { severity: "warning" },
      annotations: {
        summary: escapePrometheusTemplate(
          `{{ $labels.environment }} has waited over ${String(DELIVERY_QUEUE_STALL_SECONDS / 3600)} hours to dispatch`,
        ),
        message: escapePrometheusTemplate(
          "A queued deployment of {{ $labels.environment }} has waited {{ $value | humanizeDuration }} without a claim, counting the queued requests a newer set revision superseded. That is longer than any single bounded holder of the dispatch barrier (D8). Check for DeliveryRecoveryRequired first, then a long-running self-hosted deployment, an unmet prerequisite and a paused delivery-dispatch Schedule.",
        ),
        runbook_url: STALLED_DISPATCH_RUNBOOK,
      },
    },
    {
      // A running holder is ordinary, a recovery-required one already fires
      // DeliveryRecoveryRequired, and a content recovery holds the lock as its
      // journaled producer barrier until restoration. Any other holder is
      // terminal and settled, yet still blocks every platform deployment:
      // the dispatch sweep releases it within a tick, so this outlasting
      // five minutes means the sweep is not running.
      alert: "DeliveryPlatformLockStranded",
      expr: expr(
        `max by (environment, service_id, holder_status) (delivery_platform_lock_held_seconds{${DELIVERY_TARGET},holder_status!="running",recovery_required="false",producer_barrier="false"})`,
      ),
      for: "5m",
      labels: { severity: "warning" },
      annotations: {
        summary: escapePrometheusTemplate(
          "A {{ $labels.holder_status }} deployment of {{ $labels.environment }} holds the Delivery platform lock",
        ),
        message: escapePrometheusTemplate(
          "The shared-resources platform lock has been held for {{ $value | humanizeDuration }} by a {{ $labels.holder_status }} deployment of {{ $labels.environment }} (service {{ $labels.service_id }}) that is not running, not recovery-required and holds no content producer barrier. Finish and every recovery settlement release it, and the sweep on every delivery-dispatch tick releases any a settled holder kept, so a lock that stays held means that sweep is not running: check the delivery-dispatch Schedule and the reconcile activity. Every deployment needing the platform lock (OpenTofu stacks, cluster admission, delivery-control-plane) answers BUSY and stays queued. Find the holder with `toolkit deploy status --json`, then follow the runbook. Do not start another platform operation until the lock is released.",
        ),
        runbook_url: STALLED_DISPATCH_RUNBOOK,
      },
    },
    {
      // The dispatch sweep already released the rows, so nothing is blocked
      // now; the alert names a transition that still leaks ownership.
      alert: "DeliveryStaleOwnershipReleased",
      expr: expr(
        `sum by (kind) (increase(delivery_stale_ownership_released_total{${DELIVERY_TARGET}}[1h])) > 0`,
      ),
      labels: { severity: "warning" },
      annotations: {
        summary: escapePrometheusTemplate(
          "The Delivery dispatch sweep released a {{ $labels.kind }} a settled deployment kept",
        ),
        message: escapePrometheusTemplate(
          "In the last hour the dispatch sweep released {{ $value }} {{ $labels.kind }} row(s) held by a deployment that was terminal and not recovery-required. Finish, cancellation and every recovery settlement release the target locks, platform lock and active pointer of the deployment themselves, so some path (or a manual database change) made a deployment terminal or cleared recoveryRequired without releasing them. Nothing is blocked now; find the deployment in the Delivery audit rows with action deployment.stale_ownership_released, trace how it became settled and fix that path.",
        ),
        runbook_url: STALLED_DISPATCH_RUNBOOK,
      },
    },
    ...(transition ? [DELIVERY_MONITOR_ALARMED] : []),
  ];
}

export function createDeliveryMonitoring(
  chart: Chart,
  transition: boolean = transitionRendering(),
) {
  createServiceMonitor(chart, { name: "delivery", port: "http" });
  new PrometheusRule(chart, "delivery-alerts", {
    metadata: { labels: { release: "prometheus" } },
    spec: {
      groups: [
        {
          name: "delivery-control-plane",
          rules: deliveryAlertRules(transition),
        },
      ],
    },
  });
}
