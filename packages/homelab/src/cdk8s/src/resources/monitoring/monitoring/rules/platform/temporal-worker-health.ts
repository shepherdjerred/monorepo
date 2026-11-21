import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

type PrometheusRule = NonNullable<PrometheusRuleSpecGroups["rules"]>[number];

/**
 * Task-queue name as it appears on the Temporal **server's** own metrics.
 *
 * The server sanitizes its metric tag values, so `monorepo-workflows` is
 * published as `monorepo_workflows`. The SDK's exporter does not, so
 * `temporal_worker_num_pollers` keeps the hyphen. Selecting the hyphenated
 * name against a server metric matches nothing and yields a rule that cannot
 * fire — which is exactly how a fifteen-hour total outage of the workflow
 * plane produced no page: seven of the eleven central queues have a hyphen,
 * including `monorepo-workflows`.
 *
 * Use this for `approximate_backlog_*` only. Never for `task_queue` on SDK
 * metrics.
 */
export function serverMetricTaskQueue(queue: string): string {
  return queue.replaceAll("-", "_");
}
type TemporalDomainQueueDefinition = {
  queue: string;
  metricsNamespace: string;
  deploymentPattern: string;
  servicePattern: string;
  candidateDeploymentPattern?: string;
  candidateServicePattern?: string;
  candidatePollerServicePattern?: string;
  activityPoller: boolean;
  /** False for queues exposing Activities only. */
  workflowPoller?: boolean;
  servedNamespaces: readonly string[];
  /**
   * Namespaces that carry *workflow* pollers, when they differ from the
   * activity ones.
   *
   * `workerNamespaces()` gives the `scout` role's activity workers `beta`,
   * but the `workflows` role only gets `beta` for `monorepo-workflows`. So
   * `scout` receives activity tasks in `beta` while its workflows run on
   * `beta/monorepo-workflows` — no workflow poller belongs on `beta/scout`.
   * Driving both rules from one list made the workflow rule permanently short
   * by one namespace, so it fired continuously and meant nothing.
   */
  workflowServedNamespaces?: readonly string[];
};

const scoutWorkflowQueues: TemporalDomainQueueDefinition[] = (
  ["beta", "prod"] as const
).map((stage) => ({
  queue: `scout-${stage}`,
  metricsNamespace: `scout-${stage}`,
  deploymentPattern: ".*delivery-wf-retained-[a-f0-9]{12}",
  servicePattern: ".*delivery-wf-retained-.*metrics.*",
  activityPoller: false,
  servedNamespaces: [stage],
}));

export const TEMPORAL_DOMAIN_QUEUES: readonly TemporalDomainQueueDefinition[] =
  [
    {
      queue: "monorepo-workflows",
      metricsNamespace: "temporal",
      deploymentPattern: ".*delivery-wf-retained-[a-f0-9]{12}",
      servicePattern: ".*delivery-wf-retained-.*metrics.*",
      activityPoller: false,
      servedNamespaces: ["prod", "beta"],
    },
    ...scoutWorkflowQueues,
    {
      queue: "home",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-home-worker",
      servicePattern: ".*temporal-home-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "reports",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-reports-worker",
      servicePattern: ".*temporal-reports-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "infra",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-infra-worker",
      servicePattern: ".*temporal-infra-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "ops",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-infra-worker",
      servicePattern: ".*temporal-infra-worker.*metrics.*",
      activityPoller: true,
      workflowPoller: false,
      servedNamespaces: ["prod"],
    },
    {
      queue: "repo-automation",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-repo-worker",
      servicePattern: ".*temporal-repo-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "scout",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-scout-worker",
      servicePattern: ".*temporal-scout-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod", "beta"],
      workflowServedNamespaces: ["prod"],
    },
    {
      queue: "agent-task",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-agent-worker",
      servicePattern: ".*temporal-agent-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "glitter-corpus",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-glitter-corpus-worker",
      servicePattern: ".*temporal-glitter-corpus-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "glitter-context",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-glitter-context-worker",
      servicePattern: ".*temporal-glitter-context-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "billing",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-billing-worker",
      servicePattern: ".*temporal-billing-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "streambot",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-streambot-worker",
      servicePattern: ".*temporal-streambot-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
    {
      queue: "maintenance",
      metricsNamespace: "woodpecker-ci",
      deploymentPattern: "temporal-maintenance-worker",
      servicePattern: ".*temporal-maintenance-worker.*metrics.*",
      activityPoller: true,
      servedNamespaces: ["prod"],
    },
  ];

/** Native desired replicas reflect the frozen pool, including deliberate retirement to zero. */
export function buildRetainedWorkflowWorkerHealthRules(): PrometheusRule[] {
  return ["temporal", "scout-beta", "scout-prod"].map((namespace) => {
    const selector = `namespace="${namespace}",deployment=~".*delivery-wf-retained-[a-f0-9]{12}"`;
    return {
      alert: "TemporalRetainedWorkflowWorkerUnavailable",
      annotations: {
        summary: "Retained workflow worker has no running pods",
        description: escapePrometheusTemplate(
          "Retained workflow worker deployment {{ $labels.deployment }} in {{ $labels.namespace }} wants replicas but has none available, stalling workflows pinned to that build. Check pod events and image pull status in {{ $labels.namespace }} to restore that exact retained build.",
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        `(kube_deployment_spec_replicas{${selector}} > 0) unless on(namespace, deployment) (kube_deployment_status_replicas_available{${selector}} > 0)`,
      ),
      for: "5m",
      labels: { severity: "warning", worker_namespace: namespace },
    };
  });
}

export function buildTemporalDomainWorkerHealthRules(): PrometheusRule[] {
  return TEMPORAL_DOMAIN_QUEUES.flatMap((definition) => {
    const servedNamespaces = definition.servedNamespaces.join("|");
    // `namespace` is the Kubernetes namespace Prometheus scraped the pod in,
    // so both poller types share it: the maintenance worker runs in
    // `woodpecker` and the Scout workflow workers in their stage namespaces,
    // and hardcoding `temporal` here selected no series at all for them —
    // an alert that can never fire.
    const pollerSelector = `namespace="${definition.metricsNamespace}",exported_namespace=~"${servedNamespaces}",task_queue="${definition.queue}"`;
    const workflowNamespaces =
      definition.workflowServedNamespaces ?? definition.servedNamespaces;
    const workflowPollerSelector = `namespace="${definition.metricsNamespace}",exported_namespace=~"${workflowNamespaces.join("|")}",task_queue="${definition.queue}"`;
    // Server metric, so the queue name is sanitized — see serverMetricTaskQueue.
    const backlogQueue = serverMetricTaskQueue(definition.queue);
    const labels = { severity: "warning", task_queue: definition.queue };
    const candidateDeploymentPattern = definition.candidateDeploymentPattern;
    const candidateServicePattern = definition.candidateServicePattern;
    const candidatePollerSelector =
      definition.candidatePollerServicePattern === undefined
        ? pollerSelector
        : `${pollerSelector},service=~"${definition.candidatePollerServicePattern}"`;
    const activityRules: PrometheusRule[] = definition.activityPoller
      ? [
          {
            alert: "TemporalDomainActivityPollerUnavailable",
            annotations: {
              summary: `Temporal activity poller unavailable for ${definition.queue}`,
              description: `Task queue ${definition.queue} has had neither an idle activity poller nor an active execution slot for 5 minutes, so queued activities cannot run. Check the worker pod health, logs, and Temporal server connectivity in namespace ${definition.metricsNamespace}.`,
            },
            expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
              `(count((sum by (exported_namespace) (temporal_worker_num_pollers{${pollerSelector},poller_type="activity_task"}) > 0) or (sum by (exported_namespace) (temporal_worker_worker_task_slots_used{${pollerSelector},worker_type="ActivityWorker"}) > 0)) or vector(0)) < ${String(definition.servedNamespaces.length)}`,
            ),
            for: "5m",
            labels,
          },
        ]
      : [];
    const latencyExpression = definition.activityPoller
      ? `histogram_quantile(0.95, sum by (le) (rate(temporal_worker_workflow_task_schedule_to_start_latency_seconds_bucket{${pollerSelector}}[5m]))) > 5 or histogram_quantile(0.95, sum by (le) (rate(temporal_worker_activity_schedule_to_start_latency_seconds_bucket{${pollerSelector}}[5m]))) > 5`
      : `histogram_quantile(0.95, sum by (le) (rate(temporal_worker_workflow_task_schedule_to_start_latency_seconds_bucket{${pollerSelector}}[5m]))) > 5`;
    return [
      ...(definition.workflowPoller === false
        ? []
        : [
            {
              alert: "TemporalDomainWorkflowPollerUnavailable",
              annotations: {
                summary: `Temporal workflow poller unavailable for ${definition.queue}`,
                description: `Task queue ${definition.queue} is missing workflow pollers in one or more served namespaces for 5 minutes, preventing workflows from advancing. Check the worker deployment and Temporal connectivity in namespace ${definition.metricsNamespace}.`,
              },
              expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
                `count(sum by (exported_namespace) (temporal_worker_num_pollers{${workflowPollerSelector},poller_type="workflow_task"})) < ${String(workflowNamespaces.length)}`,
              ),
              for: "5m",
              labels,
            },
          ]),
      ...activityRules,
      {
        alert: "TemporalDomainQueueBacklog",
        annotations: {
          summary: `Temporal task backlog growing on ${definition.queue}`,
          description: `Task queue ${definition.queue} has had queued tasks waiting in Temporal for 10 minutes, delaying workflow or activity execution. Check poller availability, worker saturation, and schedule-to-start latency before scaling capacity.`,
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `max(approximate_backlog_count{namespace="temporal",taskqueue="${backlogQueue}",task_type=~"${definition.activityPoller ? "Workflow|Activity" : "Workflow"}"}) > 0`,
        ),
        for: "10m",
        labels,
      },
      {
        alert: "TemporalDomainScheduleToStartHigh",
        annotations: {
          summary: `Temporal task pickup latency is high on ${definition.queue}`,
          description: `The 95th-percentile wait time before a worker picks up tasks on ${definition.queue} has exceeded 5 seconds for 5 minutes, slowing workflow execution. Check worker slot utilization, CPU throttling, and poller counts in namespace ${definition.metricsNamespace}.`,
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(latencyExpression),
        for: "5m",
        labels,
      },
      {
        alert: "TemporalDomainWorkerScrapeDown",
        annotations: {
          summary: `Temporal worker metrics scrape is down for ${definition.queue}`,
          description: `Prometheus cannot scrape metrics from the ${definition.queue} worker in namespace ${definition.metricsNamespace}, blinding poller and latency alerts for this queue. Check the worker pod, metrics Service, and ServiceMonitor.`,
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
          summary: `Temporal worker has no ready pods for ${definition.queue}`,
          description: `The worker deployment for queue ${definition.queue} in namespace ${definition.metricsNamespace} has no available replicas, halting task processing for that domain. Check pod status, recent rollouts, and container logs in ${definition.metricsNamespace}.`,
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `absent(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment=~"${definition.deploymentPattern}"}) or max(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment=~"${definition.deploymentPattern}"}) < 1`,
        ),
        for: "5m",
        labels,
      },
      ...(typeof candidateDeploymentPattern !== "string" ||
      typeof candidateServicePattern !== "string"
        ? []
        : [
            {
              alert: "TemporalDomainWorkflowCandidateUnavailable",
              annotations: {
                summary: `Candidate Temporal workflow worker unavailable for ${definition.queue}`,
                description: `The candidate workflow worker for ${definition.queue} in namespace ${definition.metricsNamespace} is missing ready replicas, metrics scrapes, or active pollers, making progressive rollout unsafe. Inspect the candidate deployment and pod logs before advancing traffic.`,
              },
              expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
                `absent(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment="${candidateDeploymentPattern}"}) or max(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment="${candidateDeploymentPattern}"}) < 1 or absent(up{namespace="${definition.metricsNamespace}",service=~"${candidateServicePattern}"}) or max(up{namespace="${definition.metricsNamespace}",service=~"${candidateServicePattern}"}) < 1 or count(temporal_worker_num_pollers{${candidatePollerSelector},poller_type="workflow_task"}) < 2 or min(temporal_worker_num_pollers{${candidatePollerSelector},poller_type="workflow_task"}) < 1`,
              ),
              for: "5m",
              labels: { ...labels, track: "candidate" },
            },
          ]),
    ];
  });
}
