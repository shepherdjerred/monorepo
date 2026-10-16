import { expect, test } from "vitest";
import { getTemporalRuleGroups } from "./temporal.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";
import { buildScoutRetainedWorkflowWorkerHealthRules } from "./temporal-worker-health.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const RETAINED_BUILD_ID = "1d266e3903e228d13d40fa4f28b116981829bb37";
const series = (name: string, value: number) => ({
  series: name,
  values: String(value),
});

type HealthCase = {
  name: string;
  ready: number | undefined;
  up: number | undefined;
  pollers: number | undefined;
  fires: boolean;
  missingMutable?: "stable" | "candidate";
};

test("healthy mutable tracks cannot mask a retained Workflow build outage", async () => {
  const rules = getTemporalRuleGroups().flatMap((group) => group.rules ?? []);
  const rule = buildScoutRetainedWorkflowWorkerHealthRules((stage) =>
    stage === "prod"
      ? [
          {
            track: "retained-1d266e3903e2",
            image:
              "2.0.0-1008523@sha256:d4ab832cde525daa54208c58eb080c86e3a4bee7ff904dd6186a51937ff50985",
          },
        ]
      : [],
  ).find(
    (entry) =>
      entry.alert === "TemporalScoutRetainedWorkflowWorkerUnavailable" &&
      entry.labels?.["track"] === "retained-1d266e3903e2",
  );
  if (rule === undefined)
    throw new Error("Missing retained prod Workflow rule");
  const mutableRule = rules.find(
    (entry) =>
      entry.alert === "TemporalDomainWorkflowCandidateUnavailable" &&
      entry.labels?.["task_queue"] === "scout-prod",
  );
  if (mutableRule === undefined)
    throw new Error("Missing mutable prod Workflow rule");
  const healthyOtherTracks = ["stable", "candidate"].flatMap((track) => [
    series(
      `kube_deployment_status_replicas_available{namespace="scout-prod",deployment="scout-prod-scout-workflow-worker-${track}"}`,
      1,
    ),
    series(
      `up{namespace="scout-prod",service="scout-workflow-worker-${track}-metrics-service"}`,
      1,
    ),
    series(
      `temporal_worker_num_pollers{namespace="scout-prod",exported_namespace="prod",temporal_namespace="prod",worker_deployment_name="scout-prod-workflows",worker_build_id="${track === "stable" ? "4131c62a475425780f39918807334a0166ac5d66" : "2a5f0ef5095608444d5e394c00793a083323e5a9"}",task_queue="scout-prod",poller_type="workflow_task",service="scout-workflow-worker-${track}-metrics-service"}`,
      2,
    ),
  ]);
  const deployment =
    'kube_deployment_status_replicas_available{namespace="scout-prod",deployment="scout-prod-scout-workflow-worker-retained-1d266e3903e2"}';
  const owner =
    'namespace="scout-prod",service="scout-workflow-worker-retained-1d266e3903e2-metrics-se"';
  const poller = `temporal_worker_num_pollers{${owner},exported_namespace="prod",temporal_namespace="prod",worker_deployment_name="scout-prod-workflows",worker_build_id="${RETAINED_BUILD_ID}",task_queue="scout-prod",poller_type="workflow_task"}`;
  const cases: HealthCase[] = [
    {
      name: "healthy retained worker",
      ready: 1,
      up: 1,
      pollers: 2,
      fires: false,
    },
    {
      name: "retained pod unavailable",
      ready: 0,
      up: 1,
      pollers: 2,
      fires: true,
    },
    { name: "retained scrape down", ready: 1, up: 0, pollers: 2, fires: true },
    { name: "retained pollers zero", ready: 1, up: 1, pollers: 0, fires: true },
    {
      name: "retained metrics absent",
      ready: 1,
      up: 1,
      pollers: undefined,
      fires: true,
    },
    {
      name: "retained deployment absent",
      ready: undefined,
      up: undefined,
      pollers: undefined,
      fires: true,
    },
    ...(["stable", "candidate"] as const).map((track) => ({
      name: `retained worker cannot mask missing ${track} pollers`,
      ready: 1,
      up: 1,
      pollers: 2,
      fires: false,
      missingMutable: track,
    })),
  ];
  await runPromtoolFixture({
    evaluation_interval: "1m",
    tests: cases.map(({ name, ready, up, pollers, fires, missingMutable }) => ({
      name,
      input_series: [
        ...healthyOtherTracks.filter(
          (entry) =>
            missingMutable === undefined ||
            !entry.series.startsWith("temporal_worker_num_pollers{") ||
            !entry.series.includes(
              `service="scout-workflow-worker-${missingMutable}-metrics-service"`,
            ),
        ),
        ...(ready === undefined ? [] : [series(deployment, ready)]),
        ...(up === undefined ? [] : [series(`up{${owner}}`, up)]),
        ...(pollers === undefined ? [] : [series(poller, pollers)]),
      ],
      promql_expr_test: [
        {
          expr: rule.expr.value,
          eval_time: "0m",
          exp_samples: fires ? [{ labels: "{}", value: 0 }] : [],
        },
        {
          expr: mutableRule.expr.value,
          eval_time: "0m",
          exp_samples:
            missingMutable === undefined ? [] : [{ labels: "{}", value: 1 }],
        },
      ],
    })),
  });
});

test("renders health alerts for every retained pin currently declared", () => {
  const expected = Object.keys(versions)
    .filter(
      (name) =>
        name.startsWith("shepherdjerred/scout-for-lol/") &&
        name.includes("/workflows/retained-"),
    )
    .map((name) =>
      name
        .replace("shepherdjerred/scout-for-lol/", "scout-")
        .replace("/workflows/", "/"),
    )
    .sort();
  const actual = getTemporalRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .filter(
      (rule) => rule.alert === "TemporalScoutRetainedWorkflowWorkerUnavailable",
    )
    .map((rule) => {
      const queue = rule.labels?.["task_queue"];
      const track = rule.labels?.["track"];
      if (queue === undefined || track === undefined) {
        throw new Error(
          "Retained Workflow alert is missing its queue or track",
        );
      }
      return `${queue}/${track}`;
    })
    .sort();
  expect(actual).toEqual(expected);
});
