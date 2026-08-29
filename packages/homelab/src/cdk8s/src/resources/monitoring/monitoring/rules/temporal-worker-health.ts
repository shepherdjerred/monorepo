import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { scoutWorkflowWorkerImageIsCapable } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/workflow-worker.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

type PrometheusRule = NonNullable<PrometheusRuleSpecGroups["rules"]>[number];
type TemporalDomainQueueDefinition = {
  queue: string;
  metricsNamespace: string;
  deploymentPattern: string;
  servicePattern: string;
  candidateDeploymentPattern?: string;
  candidateServicePattern?: string;
  activityPoller: boolean;
};

// Do not install these rules until both tracks can render. A capable
// candidate alone is insufficient: Scout's chart bootstraps the stable worker
// first, so candidate-only alerts would fire on absent pods.
function scoutWorkflowQueue(
  stage: "beta" | "prod",
  stableImage: string,
  candidateImage: string,
): TemporalDomainQueueDefinition[] {
  if (
    !scoutWorkflowWorkerImageIsCapable(stableImage) ||
    !scoutWorkflowWorkerImageIsCapable(candidateImage)
  ) {
    return [];
  }
  const queue = `scout-${stage}`;
  return [
    {
      queue,
      metricsNamespace: queue,
      deploymentPattern: `${queue}-scout-workflow-worker.*`,
      servicePattern: ".*scout-workflow-worker.*metrics.*",
      candidateDeploymentPattern: `${queue}-scout-workflow-worker-candidate`,
      candidateServicePattern: ".*scout-workflow-worker-candidate.*metrics.*",
      activityPoller: false,
    },
  ];
}

const scoutWorkflowQueues = [
  ...scoutWorkflowQueue(
    "beta",
    versions["shepherdjerred/scout-for-lol/beta/workflows/stable"],
    versions["shepherdjerred/scout-for-lol/beta/workflows/candidate"],
  ),
  ...scoutWorkflowQueue(
    "prod",
    versions["shepherdjerred/scout-for-lol/prod/workflows/stable"],
    versions["shepherdjerred/scout-for-lol/prod/workflows/candidate"],
  ),
];

export const TEMPORAL_DOMAIN_QUEUES: readonly TemporalDomainQueueDefinition[] =
  [
    {
      queue: "monorepo-workflows",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-workflows.*",
      servicePattern: ".*temporal-workflows.*metrics.*",
      candidateDeploymentPattern: "temporal-temporal-workflows-candidate",
      candidateServicePattern: ".*temporal-workflows-candidate.*metrics.*",
      activityPoller: false,
    },
    ...scoutWorkflowQueues,
    {
      queue: "home",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-home-worker",
      servicePattern: ".*temporal-home-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "reports",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-reports-worker",
      servicePattern: ".*temporal-reports-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "infra",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-infra-worker",
      servicePattern: ".*temporal-infra-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "repo-automation",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-repo-worker",
      servicePattern: ".*temporal-repo-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "scout",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-scout-worker",
      servicePattern: ".*temporal-scout-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "agent-task",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-agent-worker",
      servicePattern: ".*temporal-agent-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "glitter-corpus",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-glitter-corpus-worker",
      servicePattern: ".*temporal-glitter-corpus-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "glitter-context",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-glitter-context-worker",
      servicePattern: ".*temporal-glitter-context-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "backup",
      metricsNamespace: "temporal",
      deploymentPattern: "temporal-temporal-backup-worker",
      servicePattern: ".*temporal-backup-worker.*metrics.*",
      activityPoller: true,
    },
    {
      queue: "maintenance",
      metricsNamespace: "buildkite",
      deploymentPattern: "temporal-maintenance-worker",
      servicePattern: ".*temporal-maintenance-worker.*metrics.*",
      activityPoller: true,
    },
  ];

export function buildTemporalDomainWorkerHealthRules(): PrometheusRule[] {
  return TEMPORAL_DOMAIN_QUEUES.flatMap((definition) => {
    const workflowSelector = `namespace="${definition.metricsNamespace}",exported_namespace="prod",task_queue="${definition.queue}"`;
    const activitySelector = `namespace="${definition.metricsNamespace}",exported_namespace="prod",task_queue="${definition.queue}"`;
    const labels = { severity: "warning", task_queue: definition.queue };
    const candidateDeploymentPattern = definition.candidateDeploymentPattern;
    const candidateServicePattern = definition.candidateServicePattern;
    const activityRules: PrometheusRule[] = definition.activityPoller
      ? [
          {
            alert: "TemporalDomainActivityPollerUnavailable",
            annotations: {
              summary: `Temporal activity poller unavailable for ${definition.queue}`,
              description:
                "The domain queue has had no activity-task poller for five minutes. Inspect its worker pod and Temporal connectivity.",
            },
            expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
              `absent(temporal_worker_num_pollers{${activitySelector},poller_type="activity_task"}) or max(temporal_worker_num_pollers{${activitySelector},poller_type="activity_task"}) < 1`,
            ),
            for: "5m",
            labels,
          },
        ]
      : [];
    const latencyExpression = definition.activityPoller
      ? `histogram_quantile(0.95, sum by (le) (rate(temporal_worker_workflow_task_schedule_to_start_latency_seconds_bucket{${workflowSelector}}[5m]))) > 5 or histogram_quantile(0.95, sum by (le) (rate(temporal_worker_activity_schedule_to_start_latency_seconds_bucket{${activitySelector}}[5m]))) > 5`
      : `histogram_quantile(0.95, sum by (le) (rate(temporal_worker_workflow_task_schedule_to_start_latency_seconds_bucket{${workflowSelector}}[5m]))) > 5`;
    return [
      {
        alert: "TemporalDomainWorkflowPollerUnavailable",
        annotations: {
          summary: `Temporal workflow poller unavailable for ${definition.queue}`,
          description:
            "The domain queue has had no workflow-task poller for five minutes. Inspect its worker pod and Temporal connectivity.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `absent(temporal_worker_num_pollers{${workflowSelector},poller_type="workflow_task"}) or max(temporal_worker_num_pollers{${workflowSelector},poller_type="workflow_task"}) < 1`,
        ),
        for: "5m",
        labels,
      },
      ...activityRules,
      {
        alert: "TemporalDomainQueueBacklog",
        annotations: {
          summary: `Temporal task backlog on ${definition.queue}`,
          description:
            "Temporal matching has reported queued workflow or activity tasks for ten minutes. Inspect pollers and schedule-to-start latency before changing capacity.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `max(approximate_backlog_count{namespace="temporal",taskqueue="${definition.queue}",task_type=~"${definition.activityPoller ? "Workflow|Activity" : "Workflow"}"}) > 0`,
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
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(latencyExpression),
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
                summary: `Temporal candidate Workflow worker unavailable for ${definition.queue}`,
                description:
                  "The candidate Workflow Worker has no available replica or scrape. Check the candidate Deployment before advancing the ramp.",
              },
              expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
                `absent(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment="${candidateDeploymentPattern}"}) or max(kube_deployment_status_replicas_available{namespace="${definition.metricsNamespace}",deployment="${candidateDeploymentPattern}"}) < 1 or absent(up{namespace="${definition.metricsNamespace}",service=~"${candidateServicePattern}"}) or max(up{namespace="${definition.metricsNamespace}",service=~"${candidateServicePattern}"}) < 1 or count(temporal_worker_num_pollers{${workflowSelector},poller_type="workflow_task"}) < 2 or min(temporal_worker_num_pollers{${workflowSelector},poller_type="workflow_task"}) < 1`,
              ),
              for: "5m",
              labels: { ...labels, track: "candidate" },
            },
          ]),
    ];
  });
}
