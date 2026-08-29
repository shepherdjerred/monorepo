import { timeseriesPanel } from "./dashboard-panels.ts";

const TEMPO_DATASOURCE = { type: "tempo", uid: "tempo" };
const LOKI_DATASOURCE = { type: "loki", uid: "loki" };

function exploreUrl(
  datasource: "loki" | "tempo",
  query: Record<string, string>,
): string {
  return `/explore?schemaVersion=1&panes=${encodeURIComponent(
    JSON.stringify({
      temporal: {
        datasource,
        queries: [{ refId: "A", ...query }],
        range: { from: "now-1h", to: "now" },
      },
    }),
  )}`;
}

const TRACE_BY_ID_URL = exploreUrl("tempo", {
  query: "${__data.fields.trace_id}",
  queryType: "traceql",
});

function createTemporalTracePanel() {
  return {
    id: 8,
    type: "traces",
    title: "Schedule to Workflow to Activity traces",
    description:
      "End-to-end Temporal call graphs. Filter by environment and domain, then expand a trace to verify client, Workflow, child/Continue-As-New, Activity, and nested gen_ai spans.",
    datasource: TEMPO_DATASOURCE,
    gridPos: { x: 0, y: 28, w: 24, h: 10 },
    targets: [
      {
        refId: "A",
        query:
          '{ resource.deployment.environment.name =~ "$environment" && resource.temporal.domain =~ "$domain" && name =~ "(workflow|activity|child_workflow|continue_as_new).*" }',
        queryType: "traceql",
        tableType: "traces",
      },
    ],
  };
}

function createTemporalLogPanel() {
  return {
    id: 9,
    type: "logs",
    title: "Correlated Temporal logs",
    description:
      "Structured SDK, Workflow, and Activity logs. Expand a record and follow trace_id into Tempo; payloads and sensitive UI fields are prohibited.",
    datasource: LOKI_DATASOURCE,
    gridPos: { x: 0, y: 38, w: 24, h: 10 },
    fieldConfig: {
      defaults: {
        links: [
          {
            title: "Trace in Tempo",
            url: TRACE_BY_ID_URL,
            targetBlank: true,
          },
        ],
      },
      overrides: [],
    },
    options: {
      showTime: true,
      showLabels: false,
      showCommonLabels: false,
      wrapLogMessage: true,
      enableLogDetails: true,
      dedupStrategy: "none",
      sortOrder: "Descending",
    },
    targets: [
      {
        refId: "A",
        expr: '{service_name=~"temporal-worker|scout-backend"} | deployment_environment_name =~ "$environment" | temporal_domain =~ "$domain"',
        maxLines: 200,
      },
    ],
  };
}

export function temporalDashboardLinks() {
  return [
    {
      title: "Temporal UI",
      type: "link",
      url: "https://temporal-ui.tailnet-1a49.ts.net/namespaces/default/workflows",
      targetBlank: true,
      keepTime: true,
    },
    {
      title: "Tempo Explore",
      type: "link",
      url: exploreUrl("tempo", {
        query:
          '{ resource.deployment.environment.name =~ "$environment" && resource.temporal.domain =~ "$domain" }',
        queryType: "traceql",
      }),
      targetBlank: true,
      keepTime: true,
    },
    {
      title: "Loki Explore",
      type: "link",
      url: exploreUrl("loki", {
        expr: '{service_name=~"temporal-worker|scout-backend"}',
      }),
      targetBlank: true,
      keepTime: true,
    },
  ];
}

export function temporalDashboardVariables() {
  return {
    list: [
      {
        name: "environment",
        label: "Environment",
        type: "custom",
        query: "dev,beta,prod",
        includeAll: true,
        multi: true,
        allValue: ".*",
        current: { text: "All", value: "$__all", selected: true },
        options: [],
      },
      {
        name: "domain",
        label: "Domain",
        type: "custom",
        query:
          "home,reports,infra,repo,scout,agent,glitter,maintenance,platform",
        includeAll: true,
        multi: true,
        allValue: ".*",
        current: { text: "All", value: "$__all", selected: true },
        options: [],
      },
    ],
  };
}

export function createTemporalPlatformPanels() {
  return [
    timeseriesPanel({
      id: 10,
      title: "Schedule action delay",
      description:
        "Temporal scheduler delay between the nominal action time and start. The alert threshold is p95 above 60 seconds for ten minutes.",
      targets: [
        {
          expr: "histogram_quantile(0.95, sum by (le) (rate(schedule_action_delay_bucket[10m]))) or on() vector(0)",
          legend: "p95",
        },
      ],
      x: 0,
      y: 20,
      w: 8,
      h: 8,
      unit: "s",
    }),
    timeseriesPanel({
      id: 11,
      title: "Workflow Task failures",
      description:
        "Workflow Task execution failures by queue, type, and reason. Nondeterminism is a rollout stop condition.",
      targets: [
        {
          expr: 'sum by (task_queue, workflow_type, failure_reason) (increase(temporal_worker_workflow_task_execution_failed{exported_namespace="default"}[10m])) or on() vector(0)',
          legend: "{{task_queue}} {{workflow_type}} {{failure_reason}}",
        },
      ],
      x: 8,
      y: 20,
      w: 8,
      h: 8,
    }),
    timeseriesPanel({
      id: 12,
      title: "Terminal Activity failures",
      description:
        "Activities that reached a terminal failure after retry policy exhaustion.",
      targets: [
        {
          expr: 'sum by (taskqueue, workflowType, activityType) (increase(activity_fail{exported_namespace="default"}[15m])) or on() vector(0)',
          legend: "{{taskqueue}} {{workflowType}} {{activityType}}",
        },
      ],
      x: 16,
      y: 20,
      w: 8,
      h: 8,
    }),
    createTemporalTracePanel(),
    createTemporalLogPanel(),
  ];
}
