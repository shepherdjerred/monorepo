import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  SCOUT_TEMPORAL_WORKER_MISSING,
  SCOUT_WORKFLOW_ROUTING_UNKNOWN,
} from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/scout-worker-ownership.ts";

type Series = { series: string; values: string };
const a = "a".repeat(40);
const b = "b".repeat(40);
function constant(series: string, value = 1): Series {
  return { series, values: `${value.toString()}+0x10` };
}
const embedded = ["beta", "prod"].flatMap((environment) =>
  [
    "interactive",
    "lake",
    "realtime",
    "background",
    ...(environment === "prod" ? ["workflow"] : []),
  ].map((queue) => {
    const role = ["realtime", "background"].includes(queue)
      ? "activity-worker"
      : "application";
    return constant(
      `scout_temporal_workers{environment="${environment}",role="${role}",queue_class="${queue}",namespace="scout-${environment}",pod="${role}"}`,
    );
  }),
);
const scrapes = ["beta", "prod"].flatMap((stage) =>
  ["application", "activity-worker"].map((pod) =>
    constant(`up{namespace="scout-${stage}",pod="${pod}"}`),
  ),
);
const known = constant(
  'scout_temporal_workflow_routing_known{environment="beta",role="application",namespace="scout-beta",pod="application"}',
);
const routingTime: Series = {
  series:
    'scout_temporal_workflow_routing_timestamp_seconds{environment="beta",role="application",namespace="scout-beta",pod="application"}',
  values: "0+60x10",
};
function route(build: string, routing = "current", percentage = 100): Series {
  return constant(
    `scout_temporal_workflow_routed_version{environment="beta",role="application",namespace="scout-beta",pod="application",temporal_namespace="beta",worker_deployment_name="scout-beta-workflows",worker_build_id="${build}",routing="${routing}"}`,
    percentage,
  );
}
function poller(build: string, type = "workflow_task", value = 1): Series {
  return constant(
    `temporal_worker_num_pollers{environment="beta",temporal_namespace="beta",namespace="scout-beta",pod="workflow-${build}",task_queue="scout-beta",worker_deployment_name="scout-beta-workflows",worker_build_id="${build}",poller_type="${type}"}`,
    value,
  );
}
function workerScrape(build: string, value = 1): Series {
  return constant(`up{namespace="scout-beta",pod="workflow-${build}"}`, value);
}
const base = [...embedded, ...scrapes, known, routingTime];
const current = [route(a), poller(a), workerScrape(a)];
const cases = [
  {
    name: "all declared owners healthy",
    input: [...base, ...current],
    missing: 0,
    unknown: 0,
  },
  {
    name: "unrouted candidate cannot cover current",
    input: [...base, route(a), poller(b), workerScrape(b)],
    missing: 1,
    unknown: 0,
  },
  {
    name: "sticky-only current cannot accept normal tasks",
    input: [
      ...base,
      route(a),
      poller(a, "sticky_workflow_task"),
      workerScrape(a),
    ],
    missing: 1,
    unknown: 0,
  },
  {
    name: "zero pollers are missing",
    input: [...base, route(a), poller(a, "workflow_task", 0), workerScrape(a)],
    missing: 1,
    unknown: 0,
  },
  {
    name: "failed same-pod scrape cannot prove polling",
    input: [...base, route(a), poller(a), workerScrape(a, 0)],
    missing: 1,
    unknown: 0,
  },
  {
    name: "another pod's scrape cannot cover current",
    input: [...base, route(a), poller(a), workerScrape(b)],
    missing: 1,
    unknown: 0,
  },
  {
    name: "stale SDK gauge cannot prove polling",
    input: [
      ...base,
      route(a),
      { ...poller(a), values: "1+0x7" },
      workerScrape(a),
    ],
    missing: 1,
    unknown: 0,
  },
  {
    name: "nonzero ramp also needs pollers",
    input: [...base, ...current, route(b, "ramp", 50)],
    missing: 1,
    unknown: 0,
  },
  {
    name: "current remains required at full ramp",
    input: [...base, route(a), route(b, "ramp"), poller(b), workerScrape(b)],
    missing: 1,
    unknown: 0,
  },
  {
    name: "both current and ramp healthy",
    input: [
      ...base,
      ...current,
      route(b, "ramp", 50),
      poller(b),
      workerScrape(b),
    ],
    missing: 0,
    unknown: 0,
  },
  {
    name: "zero ramp does not require candidate",
    input: [...base, ...current, route(b, "ramp", 0)],
    missing: 0,
    unknown: 0,
  },
  {
    name: "lookup failure reports unknown",
    input: [
      ...base.filter((item) => item !== known),
      { ...known, values: "0+0x10" },
      ...current,
    ],
    missing: 0,
    unknown: 1,
  },
  {
    name: "absent routing reports unknown",
    input: [...embedded, ...scrapes, poller(a), workerScrape(a)],
    missing: 0,
    unknown: 1,
  },
  {
    name: "stale lookup timestamp reports unknown",
    input: [
      ...base.filter((item) => item !== routingTime),
      { ...routingTime, values: "0+0x10" },
      ...current,
    ],
    missing: 0,
    unknown: 1,
  },
  {
    name: "missing declared activity owner",
    input: [
      ...base.filter(
        (item) =>
          !item.series.includes('queue_class="realtime"') ||
          !item.series.includes('environment="beta"'),
      ),
      ...current,
    ],
    missing: 1,
    unknown: 0,
  },
  {
    name: "outage evidence never expires",
    input: [],
    missing: 9,
    unknown: 1,
    evalTime: "40d",
  },
];

const directory = await mkdtemp(path.join(tmpdir(), "scout-worker-ownership-"));
const filename = path.join(directory, "tests.yaml");
try {
  for (const entry of cases) {
    await Bun.write(
      filename,
      YAML.stringify({
        evaluation_interval: "1m",
        tests: [
          {
            name: entry.name,
            interval: "1m",
            input_series: entry.input,
            promql_expr_test: [
              {
                expr: `sum(${SCOUT_TEMPORAL_WORKER_MISSING}) or vector(0)`,
                eval_time: entry.evalTime ?? "10m",
                exp_samples: [{ labels: "{}", value: entry.missing }],
              },
              {
                expr: `sum(${SCOUT_WORKFLOW_ROUTING_UNKNOWN}) or vector(0)`,
                eval_time: entry.evalTime ?? "10m",
                exp_samples: [{ labels: "{}", value: entry.unknown }],
              },
            ],
          },
        ],
      }),
    );
    const child = Bun.spawn(["promtool", "test", "rules", filename], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${entry.name}: ${stdout}\n${stderr}`);
    console.log(`passed: ${entry.name}`);
  }
} finally {
  await rm(filename);
  await rmdir(directory);
}
