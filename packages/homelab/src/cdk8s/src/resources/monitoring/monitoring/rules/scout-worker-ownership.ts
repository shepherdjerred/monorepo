/** Hosted queue ownership; beta Workflow tasks use Worker Deployment routing. */
const EMBEDDED_OWNERS = [
  {
    environment: "beta",
    role: "application",
    queues: ["interactive", "lake"],
  },
  {
    environment: "prod",
    role: "application",
    queues: ["workflow", "interactive", "lake"],
  },
  {
    environment: "beta",
    role: "activity-worker",
    queues: ["realtime", "background"],
  },
  {
    environment: "prod",
    role: "activity-worker",
    queues: ["realtime", "background"],
  },
];

function fresh(metric: string, condition = "> 0"): string {
  return `(${metric} ${condition} and (time() - timestamp(${metric}) < 90))`;
}

function successfulScrape(namespace: string): string {
  return fresh(`up{namespace="${namespace}"}`, "== 1");
}

function expected(environment: string, queue?: string): string {
  const stage = `label_replace(vector(1), "environment", "${environment}", "", "")`;
  return queue === undefined
    ? stage
    : `label_replace(${stage}, "queue_class", "${queue}", "", "")`;
}

const ROUTING_EVIDENCE = `${fresh('scout_temporal_workflow_routing_known{environment="beta",role="application"}', "== 1")} and on (namespace, pod) (scout_temporal_workflow_routing_timestamp_seconds{environment="beta",role="application"} > time() - 90) and on (namespace, pod) ${successfulScrape("scout-beta")}`;
const ROUTING_KNOWN = `max by (environment) (${ROUTING_EVIDENCE})`;

const ROUTED = `${fresh('scout_temporal_workflow_routed_version{environment="beta",role="application"}')} and on (namespace, pod) (${ROUTING_EVIDENCE})`;
const POLLERS = `${fresh('temporal_worker_num_pollers{environment="beta",temporal_namespace="beta",worker_deployment_name="scout-beta-workflows",task_queue="scout-beta",poller_type="workflow_task"}')} and on (namespace, pod) ${successfulScrape("scout-beta")}`;

export const SCOUT_WORKFLOW_ROUTING_UNKNOWN = `${expected("beta")} unless on (environment) (${ROUTING_KNOWN})`;

const WORKFLOW_MISSING = `label_replace((max by (environment) ((${ROUTED}) unless on (environment, temporal_namespace, worker_deployment_name, worker_build_id) (${POLLERS})) > bool 0), "queue_class", "workflow", "", "")`;

export const SCOUT_TEMPORAL_WORKER_MISSING = [
  ...EMBEDDED_OWNERS.flatMap(({ environment, role, queues }) =>
    queues.map((queue) => {
      const metric = `scout_temporal_workers{environment="${environment}",role="${role}",queue_class="${queue}"}`;
      const healthy = `max by (environment, queue_class) (${fresh(metric)} and on (namespace, pod) ${successfulScrape(`scout-${environment}`)})`;
      return `(${expected(environment, queue)} unless on (environment, queue_class) (${healthy}))`;
    }),
  ),
  `(${WORKFLOW_MISSING})`,
].join(" or ");
