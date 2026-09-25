import { describe, expect, test } from "vitest";

import {
  fetchCiBuild,
  fetchCiBuilds,
  queryPrometheusVector,
  type CiBuild,
  type CiJob,
  type PrometheusClientConfig,
  type TimeWindow,
  type WoodpeckerClientConfig,
} from "./ci-io-api.ts";
import { parseCliOptions } from "./ci-io-cli.ts";
import { aggregatePodMetrics } from "./ci-io-aggregate.ts";
import { renderCiIoMarkdown } from "./ci-io-markdown.ts";
import {
  CI_RECORDED_PARENT_WRITES_BY_JOB_METRIC,
  buildIoQueries,
  fetchPrometheusIoMetrics,
  filterPrometheusIoMetrics,
  type DeviceMetric,
  type MetricMetadata,
  type NetworkMetric,
  type PrometheusIoMetrics,
} from "./ci-io-prometheus.ts";
import {
  assertBenchmarkIntegrity,
  buildWindowIoReport as buildRawWindowIoReport,
  type BuildWindowReportInput,
} from "./ci-io-report.ts";
import type { CiIoReport, WindowIoReport } from "./ci-io-report-model.ts";
import { selectCohortBuilds, selectExplicitBuilds } from "./ci-io-selection.ts";

const WINDOW: TimeWindow = {
  from: new Date("2026-07-20T00:00:00.000Z"),
  to: new Date("2026-07-20T00:10:00.000Z"),
};

/**
 * A job is identified by `<commit>:<step key>`, because that is what the step
 * pod's Kubernetes labels carry. The two fixture builds therefore need
 * DIFFERENT commits: they both run a step keyed `fixture`, and on one commit
 * those two jobs would be the same job — which the report rejects outright.
 */
const COMMITS = {
  a: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  b: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
} as const;

const WOODPECKER_URL = "https://woodpecker.sjer.red";
const REPO_ID = 7;

function jobId(commit: string, stepKey: string): string {
  return `${commit}:${stepKey}`;
}

const IDS = {
  long: jobId(COMMITS.a, "fixture"),
  short: jobId(COMMITS.a, "short"),
  canceled: jobId(COMMITS.a, "cancel"),
  canceledBuild: jobId(COMMITS.b, "fixture"),
  notRun: jobId(COMMITS.a, "images-pr"),
} as const;

/**
 * Woodpecker names step pods after a ULID and a step index, so unlike
 * Buildkite's `buildkite-<job uuid>-<suffix>` a pod name cannot be derived
 * from — or matched back to — a job. Fixtures record the mapping instead.
 */
const PODS = new Map<string, string>();
let podSequence = 0;

function nextPodName(): string {
  podSequence += 1;
  const ulid = `01hcd83q7be5ymh89k5ac${podSequence.toString().padStart(5, "0")}`;
  return `wp-${ulid}-0-step-0`;
}

function podFor(jobIdentity: string, suffix = "primary"): string {
  const pod = PODS.get(`${jobIdentity}\u{0}${suffix}`);
  if (pod === undefined) {
    throw new Error(`no fixture pod recorded for ${jobIdentity}/${suffix}`);
  }
  return pod;
}

type TestWindowReportInput = Omit<
  BuildWindowReportInput,
  "cohort" | "unfinishedBuilds"
> &
  Partial<Pick<BuildWindowReportInput, "cohort" | "unfinishedBuilds">>;

function buildWindowIoReport(input: TestWindowReportInput): WindowIoReport {
  return buildRawWindowIoReport({
    ...input,
    cohort: input.cohort ?? null,
    unfinishedBuilds: input.unfinishedBuilds ?? [],
  });
}

function buildUrl(number: number): string {
  return `${WOODPECKER_URL}/repos/${String(REPO_ID)}/pipeline/${String(number)}`;
}

function buildFixture(input: {
  number: number;
  commit: string;
  state: string;
  branch: string;
  jobs: CiJob[];
}): CiBuild {
  return {
    number: input.number,
    commit: input.commit,
    state: input.state,
    branch: input.branch,
    created_at: "2026-07-20T00:00:00.000Z",
    started_at: "2026-07-20T00:00:01.000Z",
    finished_at: "2026-07-20T00:09:00.000Z",
    web_url: buildUrl(input.number),
    jobs: input.jobs,
  };
}

function jobFixture(input: {
  commit: string;
  buildNumber: number;
  name: string;
  stepKey: string;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
}): CiJob {
  return {
    id: jobId(input.commit, input.stepKey),
    name: input.name,
    step_key: input.stepKey,
    state: input.state,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    web_url: `${buildUrl(input.buildNumber)}/1`,
    exit_status: input.state === "success" ? 0 : null,
  };
}

function emptyMetrics(): PrometheusIoMetrics {
  return {
    parentMax: [],
    parentSamples: [],
    parentLastSample: [],
    parentResets: [],
    childMax: [],
    networkReceiveMax: [],
    networkTransmitMax: [],
    networkReceiveResets: [],
    networkTransmitResets: [],
  };
}

function parentMetric(input: {
  pod: string;
  device: string | null;
  value: number;
  node?: string;
  metadata?: MetricMetadata | null;
}): DeviceMetric {
  return {
    pod: input.pod,
    node: input.node ?? "ci-node",
    device: input.device,
    value: input.value,
    metadata: input.metadata ?? null,
  };
}

function networkMetric(
  pod: string,
  networkInterface: string,
  value: number,
  node = "ci-node",
): NetworkMetric {
  return { pod, node, networkInterface, value };
}

function metadataFor(jobIdentity: string, branch: string): MetricMetadata {
  const [commit, stepKey] = jobIdentity.split(":");
  if (commit === undefined || stepKey === undefined) {
    throw new Error(`malformed fixture job id ${jobIdentity}`);
  }
  return {
    jobId: jobIdentity,
    commit,
    stepKey,
    branch,
    pipelineUrl: `https://github.com/shepherdjerred/monorepo/commit/${commit}`,
  };
}

function addPod(input: {
  metrics: PrometheusIoMetrics;
  jobId: string;
  suffix?: string;
  branch?: string;
  writes: number;
  samples: number;
  resets?: number;
  receive?: number;
  transmit?: number;
  node?: string;
  lastSampleTimestampSeconds?: number;
  container?: string;
  metadata?: MetricMetadata | null;
}): string {
  const pod = nextPodName();
  PODS.set(`${input.jobId}\u{0}${input.suffix ?? "primary"}`, pod);
  const metadata =
    input.metadata === undefined
      ? metadataFor(input.jobId, input.branch ?? "feature/io")
      : input.metadata;
  const device = "overlay";
  const node = input.node ?? "ci-node";
  input.metrics.parentMax.push(
    parentMetric({
      pod,
      device,
      value: input.writes,
      node,
      metadata,
    }),
  );
  input.metrics.parentSamples.push(
    parentMetric({
      pod,
      device,
      value: input.samples,
      node,
      metadata,
    }),
  );
  input.metrics.parentLastSample.push(
    parentMetric({
      pod,
      device,
      value: input.lastSampleTimestampSeconds ?? WINDOW.to.getTime() / 1000,
      node,
    }),
  );
  input.metrics.parentResets.push(
    parentMetric({
      pod,
      device,
      value: input.resets ?? 0,
      node,
      metadata,
    }),
  );
  input.metrics.childMax.push({
    ...parentMetric({
      pod,
      device,
      value: input.writes,
      node,
      metadata,
    }),
    container: input.container ?? "container-0",
  });
  input.metrics.networkReceiveMax.push(
    networkMetric(pod, "eth0", input.receive ?? 10, node),
  );
  input.metrics.networkTransmitMax.push(
    networkMetric(pod, "eth0", input.transmit ?? 20, node),
  );
  input.metrics.networkReceiveResets.push(networkMetric(pod, "eth0", 0, node));
  input.metrics.networkTransmitResets.push(networkMetric(pod, "eth0", 0, node));
  return pod;
}

function reportBuilds(): CiBuild[] {
  return [
    buildFixture({
      number: 101,
      commit: COMMITS.a,
      state: "success",
      branch: "feature/io",
      jobs: [
        jobFixture({
          commit: COMMITS.a,
          buildNumber: 101,
          name: "long fixture",
          stepKey: "fixture",
          state: "success",
          startedAt: "2026-07-20T00:01:00.000Z",
          finishedAt: "2026-07-20T00:02:00.000Z",
        }),
        jobFixture({
          commit: COMMITS.a,
          buildNumber: 101,
          name: "short fixture",
          stepKey: "short",
          state: "success",
          startedAt: "2026-07-20T00:02:00.000Z",
          finishedAt: "2026-07-20T00:02:20.000Z",
        }),
        jobFixture({
          commit: COMMITS.a,
          buildNumber: 101,
          name: "canceled fixture",
          stepKey: "cancel",
          state: "canceled",
          startedAt: "2026-07-20T00:03:00.000Z",
          finishedAt: "2026-07-20T00:03:50.000Z",
        }),
      ],
    }),
    buildFixture({
      number: 102,
      commit: COMMITS.b,
      state: "canceled",
      branch: "main",
      jobs: [
        jobFixture({
          commit: COMMITS.b,
          buildNumber: 102,
          name: "fixture in canceled build",
          stepKey: "fixture",
          state: "success",
          startedAt: "2026-07-20T00:04:00.000Z",
          finishedAt: "2026-07-20T00:05:00.000Z",
        }),
      ],
    }),
  ];
}

function reportMetrics(): PrometheusIoMetrics {
  const metrics = emptyMetrics();
  const longPod = addPod({
    metrics,
    jobId: IDS.long,
    writes: 100,
    samples: 6,
    receive: 20,
    transmit: 30,
  });
  metrics.parentMax.push(
    parentMetric({ pod: longPod, device: "cache", value: 50 }),
  );
  metrics.parentSamples.push(
    parentMetric({ pod: longPod, device: "cache", value: 5 }),
  );
  metrics.parentLastSample.push(
    parentMetric({
      pod: longPod,
      device: "cache",
      value: WINDOW.to.getTime() / 1000,
    }),
  );
  metrics.parentResets.push(
    parentMetric({ pod: longPod, device: "cache", value: 0 }),
  );
  metrics.childMax[0] = {
    ...parentMetric({ pod: longPod, device: "overlay", value: 50 }),
    container: "container-0",
  };
  metrics.childMax.push({
    ...parentMetric({ pod: longPod, device: "cache", value: 100 }),
    container: "dind",
  });
  addPod({ metrics, jobId: IDS.short, writes: 40, samples: 1 });
  addPod({ metrics, jobId: IDS.canceled, writes: 20, samples: 1 });
  addPod({
    metrics,
    jobId: IDS.canceledBuild,
    branch: "main",
    writes: 70,
    samples: 5,
  });
  return metrics;
}

const METADATA_POD = "wp-01hcd83q7be5ymh89k5accn3k6-0-step-0";

/**
 * A Prometheus client answering every CI I/O query with one labelled series.
 *
 * The flattened label names are spelled out rather than imported: they are the
 * contract between the emitter, the kube-state-metrics allowlist, and the
 * recording rules, so a rename in any of them should fail a test rather than
 * quietly empty a join.
 */
function recordingClient(device: string | undefined): PrometheusClientConfig {
  const labels = {
    pod: METADATA_POD,
    node: "torvalds",
    ...(device === undefined ? {} : { device }),
    label_ci_sjer_red_commit: COMMITS.a,
    label_ci_sjer_red_step_key: "fixture",
    annotation_ci_sjer_red_branch: "feature/io",
    annotation_ci_sjer_red_pipeline_url: `https://github.com/shepherdjerred/monorepo/commit/${COMMITS.a}`,
  };
  return {
    apiBaseUrl: "http://prometheus:9090/",
    fetcher: (url) => {
      const query = new URL(url).searchParams.get("query") ?? "";
      // The timestamp probe reads raw cAdvisor, which carries no joined
      // metadata; everything else reads a recording rule, which does.
      const metric = query.includes("container_network_")
        ? { pod: METADATA_POD, node: "torvalds", interface: "eth0" }
        : query.includes("timestamp(")
          ? { pod: METADATA_POD, node: "torvalds" }
          : query.includes('container!=""')
            ? { ...labels, container: "container-0" }
            : labels;
      return Promise.resolve(
        Response.json({
          status: "success",
          data: { resultType: "vector", result: [{ metric, value: [1, "1"] }] },
        }),
      );
    },
  };
}

describe("Prometheus query contract", () => {
  test("reads writes from the enriched recording rules", () => {
    const queries = buildIoQueries(WINDOW);
    expect(queries.parentMax).toContain(
      CI_RECORDED_PARENT_WRITES_BY_JOB_METRIC,
    );
    expect(queries.parentSamples).toContain(
      "woodpecker:pod_parent_sample_present",
    );
    expect(queries.childMax).toContain(
      "woodpecker:container_fs_writes_bytes_total",
    );
    expect(queries.networkReceiveMax).toContain(
      "container_network_receive_bytes_total",
    );
  });

  // A recording rule's evaluation timestamp only proves the rule ran, so the
  // final-sample probe must stay on the underlying cAdvisor series.
  test("takes the final-sample timestamp from raw cAdvisor", () => {
    const queries = buildIoQueries(WINDOW);
    expect(queries.parentLastSample).toContain(
      "max_over_time(timestamp(container_fs_writes_bytes_total",
    );
    expect(queries.parentLastSample).toContain('container=""');
    expect(queries.parentLastSample).toContain('id=~"/kubepods.*pod[^/]+$"');
    expect(queries.parentLastSample).toContain("})[600s:10s])");
  });

  // Woodpecker pods are the only CI pods in the namespace that should be
  // measured; the server, agent and config extension share it.
  test("scopes every query to Woodpecker step pods", () => {
    for (const query of Object.values(buildIoQueries(WINDOW))) {
      expect(query).toContain('namespace="woodpecker"');
      expect(query).toContain("wp-[0-9a-hjkmnp-tv-z]{26}-[0-9]+-step-[0-9]+");
    }
  });

  // The exact flattened label names are the contract between the emitter, the
  // kube-state-metrics allowlist, and the recording rules. Spelled out here so
  // a rename in any of them fails a test rather than emptying a join.
  test("preserves recording-rule devices and enriched metadata", async () => {
    const metrics = await fetchPrometheusIoMetrics({
      client: recordingClient("/dev/nvme0n1"),
      window: WINDOW,
    });
    expect(metrics.parentMax[0]?.device).toBe("/dev/nvme0n1");
    expect(metrics.parentMax[0]?.metadata?.stepKey).toBe("fixture");
    expect(metrics.parentMax[0]?.metadata?.jobId).toBe(IDS.long);
    expect(metrics.childMax[0]?.device).toBe("/dev/nvme0n1");
  });

  // cAdvisor omits `device` for pseudo-filesystems. Absence is part of the
  // series identity, so it must survive rather than become an invented name.
  test("preserves cAdvisor series whose device label is absent", async () => {
    const metrics = await fetchPrometheusIoMetrics({
      client: recordingClient(undefined),
      window: WINDOW,
    });
    expect(metrics.parentMax[0]?.device).toBeNull();
    expect(metrics.childMax[0]?.device).toBeNull();
    expect(aggregatePodMetrics(metrics)[0]?.writeBytes).toBe(1);
  });
});

/** A pipeline as Woodpecker returns it: unix seconds, nested workflows. */
function woodpeckerPipeline(): Record<string, unknown> {
  return {
    id: 9001,
    number: 101,
    commit: COMMITS.a,
    status: "success",
    branch: "feature/io",
    created: 1_784_505_600,
    started: 1_784_505_660,
    finished: 1_784_506_140,
    workflows: [
      {
        id: 555,
        name: "fixture",
        state: "success",
        started: 1_784_505_660,
        finished: 1_784_505_720,
        children: [
          {
            id: 777,
            name: "fixture",
            state: "success",
            exit_code: 0,
            started: 1_784_505_660,
            finished: 1_784_505_720,
          },
        ],
      },
    ],
  };
}

function woodpeckerClient(
  fetcher: WoodpeckerClientConfig["fetcher"],
): WoodpeckerClientConfig {
  return {
    baseUrl: WOODPECKER_URL,
    repoId: REPO_ID,
    token: "secret-token",
    fetcher,
  };
}

describe("validated API clients", () => {
  test("flattens workflows into jobs and keeps the token out of the result", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const parsed = await fetchCiBuild(
      woodpeckerClient((url, init) => {
        requestedUrl = url;
        requestedInit = init;
        return Promise.resolve(Response.json(woodpeckerPipeline()));
      }),
      101,
    );

    expect(parsed.number).toBe(101);
    // The workflow name is the step key, and job identity is
    // <commit>:<step key> because that is what the pod labels carry.
    expect(parsed.jobs.map((job) => job.id)).toEqual([IDS.long]);
    expect(parsed.jobs[0]?.step_key).toBe("fixture");
    expect(parsed.jobs[0]?.started_at).toBe("2026-07-20T00:01:00.000Z");
    expect(parsed.created_at).toBe("2026-07-20T00:00:00.000Z");
    expect(new URL(requestedUrl).pathname.endsWith("/pipelines/101")).toBe(
      true,
    );
    expect(requestedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(parsed)).not.toContain("secret-token");
  });

  // Woodpecker uses 0, not null, for "this has not happened yet". Treating it
  // as an instant would date every unstarted step to 1970.
  test("reads a zero timestamp as absent rather than as the epoch", async () => {
    const running = {
      ...woodpeckerPipeline(),
      finished: 0,
      workflows: [
        {
          id: 555,
          name: "fixture",
          state: "running",
          started: 1_784_505_660,
          finished: 0,
          children: [
            {
              id: 777,
              name: "fixture",
              state: "running",
              exit_code: 0,
              started: 1_784_505_660,
              finished: 0,
            },
          ],
        },
      ],
    };
    const parsed = await fetchCiBuild(
      woodpeckerClient(() => Promise.resolve(Response.json(running))),
      101,
    );
    expect(parsed.finished_at).toBeNull();
    expect(parsed.jobs[0]?.finished_at).toBeNull();
    // exit_code 0 on an unfinished step means "not yet", not "succeeded".
    expect(parsed.jobs[0]?.exit_status).toBeNull();
  });

  test("lists a created cohort through the server-side date filters", async () => {
    const requested: string[] = [];
    const builds = await fetchCiBuilds(
      woodpeckerClient((url) => {
        requested.push(url);
        const parsedUrl = new URL(url);
        return Promise.resolve(
          Response.json(
            parsedUrl.pathname.endsWith("/pipelines")
              ? [{ number: 101, created: 1_784_505_600 }]
              : woodpeckerPipeline(),
          ),
        );
      }),
      { from: new Date("2026-07-20T00:00:00.000Z"), to: WINDOW.to },
    );

    expect(builds.map((current) => current.number)).toEqual([101]);
    const listUrl = new URL(requested[0] ?? "");
    expect(listUrl.searchParams.get("after")).toBe("2026-07-20T00:00:00.000Z");
    expect(listUrl.searchParams.get("before")).toBe(WINDOW.to.toISOString());
  });

  // A server that ignored `before`/`after` would otherwise silently widen the
  // cohort the benchmark reports on.
  test("re-checks the cohort window client-side", async () => {
    const builds = await fetchCiBuilds(
      woodpeckerClient((url) =>
        Promise.resolve(
          Response.json(
            new URL(url).pathname.endsWith("/pipelines")
              ? [
                  { number: 101, created: 1_784_505_600 },
                  { number: 99, created: 1_000_000_000 },
                ]
              : woodpeckerPipeline(),
          ),
        ),
      ),
      { from: new Date("2026-07-20T00:00:00.000Z"), to: WINDOW.to },
    );
    expect(builds.map((current) => current.number)).toEqual([101]);
  });

  test("rejects Woodpecker schema drift", async () => {
    await expect(
      fetchCiBuild(
        woodpeckerClient(() =>
          Promise.resolve(Response.json({ number: 101, status: "success" })),
        ),
        101,
      ),
    ).rejects.toThrow();
  });

  test("validates Prometheus vectors and surfaces API errors", async () => {
    let requestedInit: RequestInit | undefined;
    const success: PrometheusClientConfig = {
      apiBaseUrl: "http://prometheus:9090/",
      fetcher: (_url, init) => {
        requestedInit = init;
        return Promise.resolve(
          Response.json({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric: { pod: "pod" }, value: [1, "42"] }],
            },
          }),
        );
      },
    };
    const vector = await queryPrometheusVector(success, "up", WINDOW.to);
    expect(vector[0]?.value[1]).toBe("42");
    expect(requestedInit?.signal).toBeInstanceOf(AbortSignal);

    const failed: PrometheusClientConfig = {
      apiBaseUrl: "http://prometheus:9090/",
      fetcher: () =>
        Promise.resolve(
          Response.json({
            status: "error",
            errorType: "bad_data",
            error: "query rejected",
          }),
        ),
    };
    await expect(
      queryPrometheusVector(failed, "up", WINDOW.to),
    ).rejects.toThrow("Prometheus API error: bad_data");
  });
});

describe("build selection windows", () => {
  test("uses a created_at cohort to select finished builds and derive metrics", () => {
    const finished = reportBuilds()[0];
    const unfinishedSource = reportBuilds()[1];
    if (finished === undefined || unfinishedSource === undefined) {
      throw new Error("selection fixture builds missing");
    }
    const unfinished: CiBuild = {
      ...unfinishedSource,
      state: "running",
      finished_at: null,
    };
    const selection = selectCohortBuilds(
      [finished, unfinished],
      WINDOW,
      WINDOW.to,
    );
    expect(selection.builds.map((build) => build.number)).toEqual([101]);
    expect(selection.cohort).toEqual({
      createdFrom: WINDOW.from.toISOString(),
      createdTo: WINDOW.to.toISOString(),
    });
    expect(selection.window).toEqual({
      from: new Date("2026-07-19T23:59:30.000Z"),
      to: new Date("2026-07-20T00:09:30.000Z"),
    });
    expect(selection.unfinishedBuilds).toEqual([
      {
        buildNumber: 102,
        branch: "main",
        state: "running",
        createdAt: "2026-07-20T00:00:00.000Z",
        buildUrl: buildUrl(102),
        disposition: "excluded",
      },
    ]);
  });

  test("rejects an explicit selection containing only unfinished builds", () => {
    const source = reportBuilds()[0];
    if (source === undefined) {
      throw new Error("selection fixture build missing");
    }
    const unfinished: CiBuild = {
      ...source,
      state: "running",
      finished_at: null,
    };
    expect(() =>
      selectExplicitBuilds({
        builds: [unfinished],
        now: WINDOW.to,
      }),
    ).toThrow("explicit build selection has no finished builds");
  });
});

describe("pod aggregation", () => {
  test("filters concurrent builds before attribution", () => {
    const all = reportMetrics();
    const longPod = podFor(IDS.long);
    const metrics = filterPrometheusIoMetrics(all, new Set([IDS.long]));
    for (const series of Object.values(metrics)) {
      expect(series.every((metric) => metric.pod === longPod)).toBe(true);
    }
  });

  test("sums parent devices once and keeps children diagnostic", () => {
    const metrics = reportMetrics();
    const measurements = aggregatePodMetrics(metrics);
    const measurement = measurements.find((item) => item.jobId === IDS.long);
    expect(measurement?.writeBytes).toBe(150);
    expect(measurement?.componentWriteBytes).toEqual({
      "container-0": 50,
      dind: 100,
    });
    expect(measurement?.sampleCount).toBe(5);
    expect(measurement?.lastParentSampleTimestampSeconds).toBe(
      WINDOW.to.getTime() / 1000,
    );
    expect(measurement?.networkReceiveBytes).toBe(20);
    expect(measurement?.networkTransmitBytes).toBe(30);
  });

  test("rejects duplicate device series", () => {
    const metrics = reportMetrics();
    const duplicate = metrics.parentMax[0];
    if (duplicate === undefined) {
      throw new Error("fixture metric missing");
    }
    metrics.parentMax.push(duplicate);
    expect(() => aggregatePodMetrics(metrics)).toThrow(
      "duplicate parent-write series",
    );
  });
});

describe("window report", () => {
  test("reports totals, distributions, cancellations, coverage, and components", () => {
    const report = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics: reportMetrics(),
      excludedJobIds: new Set(),
      cohort: {
        createdFrom: WINDOW.from.toISOString(),
        createdTo: WINDOW.to.toISOString(),
      },
    });
    expect(report.summary.totalWriteBytes).toBe(280);
    expect(report.summary.lowerBoundWriteBytes).toBe(60);
    expect(report.summary.canceledBuildWriteBytes).toBe(70);
    expect(report.summary.canceledJobWriteBytes).toBe(20);
    expect(report.summary.completeJobCount).toBe(2);
    expect(report.summary.lowerBoundJobCount).toBe(2);
    expect(report.summary.componentWriteBytes).toEqual({
      "container-0": 180,
      dind: 100,
    });
    expect(report.selectedBuilds).toEqual([
      {
        buildNumber: 101,
        branch: "feature/io",
        commit: COMMITS.a,
        buildUrl: buildUrl(101),
      },
      {
        buildNumber: 102,
        branch: "main",
        commit: COMMITS.b,
        buildUrl: buildUrl(102),
      },
    ]);
    const fixture = report.steps.find((step) => step.stepKey === "fixture");
    expect(fixture?.totalWriteBytes).toBe(220);
    expect(fixture?.medianWriteBytes).toBe(110);
    expect(fixture?.p95WriteBytes).toBe(146);
    expect(fixture?.nodeJobCounts).toEqual({ "ci-node": 2 });
    expect(
      report.branchSteps
        .filter((step) => step.stepKey === "fixture")
        .map((step) => ({ branch: step.branch, writes: step.totalWriteBytes })),
    ).toEqual([
      { branch: "feature/io", writes: 150 },
      { branch: "main", writes: 70 },
    ]);
    expect(report.integrityIssues).toEqual([
      {
        code: "insufficient-long-job-samples",
        message: "job longer than 30 seconds has fewer than two samples",
        jobId: IDS.canceled,
        pod: podFor(IDS.canceled),
      },
    ]);
    expect(() => assertBenchmarkIntegrity(report)).toThrow(
      "insufficient-long-job-samples=1",
    );
  });

  test("fails strict mode on ambiguous pods and counter resets", () => {
    const metrics = reportMetrics();
    addPod({
      metrics,
      jobId: IDS.long,
      suffix: "other",
      writes: 10,
      samples: 3,
      resets: 1,
    });
    const report = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics,
      excludedJobIds: new Set(),
    });
    expect(report.integrityIssues.map((current) => current.code)).toContain(
      "ambiguous-job-pods",
    );
    expect(report.integrityIssues.map((current) => current.code)).toContain(
      "counter-reset",
    );
    expect(() => assertBenchmarkIntegrity(report)).toThrow();
  });

  test("treats a short job with two samples as complete", () => {
    const metrics = reportMetrics();
    const shortSample = metrics.parentSamples.find(
      (metric) => metric.pod === podFor(IDS.short),
    );
    if (shortSample === undefined) {
      throw new Error("short-job sample fixture missing");
    }
    shortSample.value = 2;
    const report = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics,
      excludedJobIds: new Set(),
    });
    const shortJob = report.jobs.find((job) => job.jobId === IDS.short);
    expect(shortJob?.coverage).toBe("complete");
  });

  test("retains unstarted validation outcomes outside the metric job list", () => {
    const source = reportBuilds()[0];
    if (source === undefined) {
      throw new Error("missing report build fixture");
    }
    const build: CiBuild = {
      ...source,
      jobs: [
        ...source.jobs,
        jobFixture({
          commit: COMMITS.a,
          buildNumber: source.number,
          name: "image validation",
          stepKey: "images-pr",
          state: "skipped",
          startedAt: null,
          finishedAt: null,
        }),
      ],
    };
    const report = buildWindowIoReport({
      builds: [build],
      window: WINDOW,
      metrics: emptyMetrics(),
      excludedJobIds: new Set(),
    });
    expect(
      report.jobOutcomes.find((outcome) => outcome.jobId === IDS.notRun),
    ).toEqual({
      buildNumber: source.number,
      buildState: source.state,
      branch: source.branch,
      jobId: IDS.notRun,
      jobName: "image validation",
      jobState: "skipped",
      stepKey: "images-pr",
      started: false,
    });
    expect(report.jobs.some((job) => job.jobId === IDS.notRun)).toBe(false);
  });
});

describe("window report integrity", () => {
  test("requires every parent device to be scraped after job completion", () => {
    const metrics = reportMetrics();
    const staleSample = metrics.parentLastSample.find(
      (metric) => metric.pod === podFor(IDS.long) && metric.device === "cache",
    );
    if (staleSample === undefined) {
      throw new Error("cache final-sample fixture missing");
    }
    staleSample.value = new Date("2026-07-20T00:01:59.000Z").getTime() / 1000;
    const firstBuild = reportBuilds()[0];
    if (firstBuild === undefined) {
      throw new Error("fixture build missing");
    }
    const report = buildWindowIoReport({
      builds: [firstBuild],
      window: WINDOW,
      metrics: filterPrometheusIoMetrics(
        metrics,
        new Set([IDS.long, IDS.short, IDS.canceled]),
      ),
      excludedJobIds: new Set([IDS.short, IDS.canceled]),
    });
    const job = report.jobs[0];
    expect(job?.coverage).toBe("lower-bound");
    expect(job?.lastParentSampleAt).toBe("2026-07-20T00:01:59.000Z");
    expect(report.integrityIssues).toEqual([
      {
        code: "missing-post-finish-parent-sample",
        message:
          "pod-parent devices do not all have a sample at or after the job finished at 2026-07-20T00:02:00.000Z",
        jobId: IDS.long,
        pod: podFor(IDS.long),
      },
    ]);
  });

  test("reports a missing last sample for any parent device", () => {
    const metrics = reportMetrics();
    metrics.parentLastSample = metrics.parentLastSample.filter(
      (metric) =>
        !(metric.pod === podFor(IDS.long) && metric.device === "cache"),
    );
    const firstBuild = reportBuilds()[0];
    if (firstBuild === undefined) {
      throw new Error("fixture build missing");
    }
    const report = buildWindowIoReport({
      builds: [firstBuild],
      window: WINDOW,
      metrics: filterPrometheusIoMetrics(
        metrics,
        new Set([IDS.long, IDS.short, IDS.canceled]),
      ),
      excludedJobIds: new Set([IDS.short, IDS.canceled]),
    });
    expect(report.jobs[0]?.coverage).toBe("lower-bound");
    expect(report.jobs[0]?.lastParentSampleAt).toBeNull();
    expect(report.integrityIssues.map((current) => current.code)).toEqual([
      "missing-post-finish-parent-sample",
    ]);
  });

  test("fails strict mode when a long job has no measurement", () => {
    const firstBuild = reportBuilds()[0];
    if (firstBuild === undefined) {
      throw new Error("fixture build missing");
    }
    const report = buildWindowIoReport({
      builds: [firstBuild],
      window: WINDOW,
      metrics: emptyMetrics(),
      excludedJobIds: new Set([IDS.short, IDS.canceled]),
    });
    expect(report.integrityIssues).toEqual([
      {
        code: "missing-long-job-measurement",
        message: "job longer than 30 seconds has no pod-parent measurement",
        jobId: IDS.long,
        pod: null,
      },
    ]);
    expect(() => assertBenchmarkIntegrity(report)).toThrow(
      "missing-long-job-measurement=1",
    );
  });

  test("excludes the active reporter job without treating its pod as unmatched", () => {
    const report = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics: reportMetrics(),
      excludedJobIds: new Set([IDS.long]),
    });
    expect(report.summary.totalWriteBytes).toBe(130);
    const unmatched = report.integrityIssues.filter(
      (current) =>
        current.code === "unmatched-pod" && current.pod === podFor(IDS.long),
    );
    expect(unmatched).toHaveLength(0);
  });

  test("validates enriched recording metadata against the CI API", () => {
    const metrics = emptyMetrics();
    const metadata: MetricMetadata = {
      jobId: IDS.long,
      commit: COMMITS.a,
      stepKey: "wrong-step",
      branch: "feature/io",
      pipelineUrl: `https://github.com/shepherdjerred/monorepo/commit/${COMMITS.a}`,
    };
    addPod({
      metrics,
      jobId: IDS.long,
      writes: 100,
      samples: 5,
      metadata,
    });
    const report = buildWindowIoReport({
      builds: [
        reportBuilds()[0] ??
          (() => {
            throw new Error("missing build");
          })(),
      ],
      window: WINDOW,
      metrics,
      excludedJobIds: new Set([IDS.short, IDS.canceled]),
    });
    expect(report.integrityIssues.map((current) => current.code)).toContain(
      "metadata-mismatch",
    );
  });
});

describe("outputs and CLI", () => {
  test("renders Markdown without client credentials", () => {
    const candidate = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics: reportMetrics(),
      excludedJobIds: new Set(),
      cohort: {
        createdFrom: WINDOW.from.toISOString(),
        createdTo: WINDOW.to.toISOString(),
      },
    });
    const report: CiIoReport = {
      schemaVersion: 5,
      generatedAt: WINDOW.to.toISOString(),
      organization: "sjerred",
      pipeline: "monorepo",
      candidate,
      baseline: null,
      comparison: null,
    };
    const markdown = renderCiIoMarkdown(report);
    expect(markdown).toContain("Child counters are diagnostic only");
    expect(markdown).toContain("Canceled-build writes");
    expect(markdown).toContain("Build cohort by `created_at`");
    expect(markdown).toContain("### Selected builds");
    expect(markdown).toContain(`\`${COMMITS.a}\``);
    expect(markdown).toContain("Per-branch step distribution");
    expect(markdown).toContain("| Build | Branch | Step | Nodes |");
    expect(markdown).toContain("feature/io");
    expect(markdown).toContain("main");
    expect(markdown).toContain("Last parent sample");
    expect(markdown).toContain("ci-node");
    expect(markdown).toContain("2026-07-20T00:10:00.000Z");
    expect(markdown).not.toContain("secret-token");
  });

  // ISO 8601 permits minute precision and --from/--to have always taken it.
  // zod 4.6 made z.iso.datetime() require seconds, which silently narrowed the
  // documented CLI contract, so minute-precision input is padded to the same
  // instant instead of being rejected. Garbage must still fail.
  test("accepts minute-precision ISO windows and still rejects malformed ones", () => {
    const parsed = parseCliOptions([
      "--from",
      "2026-09-20T12:00Z",
      "--to",
      "2026-09-20T18:30+02:00",
    ]);
    expect(parsed.from).toBe("2026-09-20T12:00:00Z");
    expect(parsed.to).toBe("2026-09-20T18:30:00+02:00");

    const withSeconds = parseCliOptions([
      "--from",
      "2026-09-20T12:00:30.500Z",
      "--to",
      "2026-09-20T18:30:00Z",
    ]);
    expect(withSeconds.from).toBe("2026-09-20T12:00:30.500Z");

    expect(() =>
      parseCliOptions([
        "--from",
        "2026-09-20T12Z",
        "--to",
        "2026-09-20T18:30Z",
      ]),
    ).toThrow();
  });

  test("parses explicit builds and requires a baseline for impact gates", () => {
    const parsed = parseCliOptions(["--build", "101,102", "--benchmark"]);
    expect(parsed.buildNumbers).toEqual([101, 102]);
    expect(parsed.benchmark).toBe(true);
    const impact = parseCliOptions([
      "--build",
      "102",
      "--baseline-build",
      "101",
      "--enforce-impact-gates",
    ]);
    expect(impact.baselineBuildNumbers).toEqual([101]);
    expect(impact.enforceImpactGates).toBe(true);
    expect(() =>
      parseCliOptions([
        "--from",
        WINDOW.from.toISOString(),
        "--to",
        WINDOW.to.toISOString(),
        "--enforce-impact-gates",
      ]),
    ).toThrow("--enforce-impact-gates requires a baseline selection");
    expect(() =>
      parseCliOptions([
        "--build",
        "102",
        "--baseline-build",
        "101",
        "--baseline-from",
        WINDOW.from.toISOString(),
        "--baseline-to",
        WINDOW.to.toISOString(),
      ]),
    ).toThrow("provide either --baseline-build or a baseline time window");
  });
});
