import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

type PrometheusRule = NonNullable<PrometheusRuleSpecGroups["rules"]>[number];

export const TEMPORAL_DOMAIN_QUEUES = [
  {
    queue: "home",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-home-worker",
    servicePattern: ".*temporal-home-worker.*metrics.*",
  },
  {
    queue: "reports",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-reports-worker",
    servicePattern: ".*temporal-reports-worker.*metrics.*",
  },
  {
    queue: "infra",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-infra-worker",
    servicePattern: ".*temporal-infra-worker.*metrics.*",
  },
  {
    queue: "repo-automation",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-repo-worker",
    servicePattern: ".*temporal-repo-worker.*metrics.*",
  },
  {
    queue: "scout",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-scout-worker",
    servicePattern: ".*temporal-scout-worker.*metrics.*",
  },
  {
    queue: "agent-task",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-agent-worker",
    servicePattern: ".*temporal-agent-worker.*metrics.*",
  },
  {
    queue: "glitter-corpus",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-glitter-corpus-worker",
    servicePattern: ".*temporal-glitter-corpus-worker.*metrics.*",
  },
  {
    queue: "glitter-context",
    metricsNamespace: "temporal",
    deployment: "temporal-temporal-glitter-context-worker",
    servicePattern: ".*temporal-glitter-context-worker.*metrics.*",
  },
  {
    queue: "maintenance",
    metricsNamespace: "buildkite",
    deployment: "temporal-maintenance-worker",
    servicePattern: ".*temporal-maintenance-worker.*metrics.*",
  },
] as const;

export function buildTemporalDomainWorkerHealthRules(): PrometheusRule[] {
  return TEMPORAL_DOMAIN_QUEUES.flatMap((definition) => {
    const workerSelector = `namespace="${definition.metricsNamespace}",exported_namespace="default",task_queue="${definition.queue}"`;
    const labels = { severity: "warning", task_queue: definition.queue };
    return [
      {
        alert: "TemporalDomainWorkflowPollerUnavailable",
        annotations: {
          summary: `Temporal workflow poller unavailable for ${definition.queue}`,
          description:
            "The domain queue has had no workflow-task poller for five minutes. Inspect its worker pod and Temporal connectivity.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `absent(temporal_worker_num_pollers{${workerSelector},poller_type="workflow_task"}) or max(temporal_worker_num_pollers{${workerSelector},poller_type="workflow_task"}) < 1`,
        ),
        for: "5m",
        labels,
      },
      {
        alert: "TemporalDomainActivityPollerUnavailable",
        annotations: {
          summary: `Temporal activity poller unavailable for ${definition.queue}`,
          description:
            "The domain queue has had no activity-task poller for five minutes. Inspect its worker pod and Temporal connectivity.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `absent(temporal_worker_num_pollers{${workerSelector},poller_type="activity_task"}) or max(temporal_worker_num_pollers{${workerSelector},poller_type="activity_task"}) < 1`,
        ),
        for: "5m",
        labels,
      },
      {
        alert: "TemporalDomainQueueBacklog",
        annotations: {
          summary: `Temporal task backlog on ${definition.queue}`,
          description:
            "Temporal matching has reported queued workflow or activity tasks for ten minutes. Inspect pollers and schedule-to-start latency before changing capacity.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `max(approximate_backlog_count{namespace="temporal",taskqueue="${definition.queue}",task_type=~"Workflow|Activity"}) > 0`,
        ),
        for: "10m",
        labels,
      },
      {
        alert: "TemporalDomainScheduleToStartHigh",
        annotations: {
          summary: `Temporal schedule-to-start latency is high on ${definition.queue}`,
          description:
            "The queue's workflow or activity schedule-to-start p95 has exceeded five seconds for five minutes.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `histogram_quantile(0.95, sum by (le) (rate(temporal_worker_workflow_task_schedule_to_start_latency_seconds_bucket{${workerSelector}}[5m]))) > 5 or histogram_quantile(0.95, sum by (le) (rate(temporal_worker_activity_schedule_to_start_latency_seconds_bucket{${workerSelector}}[5m]))) > 5`,
        ),
        for: "5m",
        labels,
      },
      {
        alert: "TemporalDomainWorkerScrapeDown",
        annotations: {
          summary: `Temporal metrics scrape is down for ${definition.queue}`,
          description:
            "Prometheus cannot scrape the domain worker. Check the component-selected Service and ServiceMonitor.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `absent(up{namespace="${definition.metricsNamespace}",service=~"${definition.servicePattern}"}) or max(up{namespace="${definition.metricsNamespace}",service=~"${definition.servicePattern}"}) < 1`,
        ),
        for: "5m",
        labels,
      },
      {
        alert: "TemporalDomainWorkerPodNotReady",
        annotations: {
          summary: `Temporal worker pod is not ready for ${definition.queue}`,
          description:
            "The single domain worker Deployment has no available replica.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `absent(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment="${definition.deployment}"}) or max(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment="${definition.deployment}"}) < 1`,
        ),
        for: "5m",
        labels,
      },
    ];
  });
}
