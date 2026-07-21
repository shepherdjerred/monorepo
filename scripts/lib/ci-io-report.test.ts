import { describe, expect, test } from "bun:test";

import {
  BuildkiteBuildSchema,
  BuildkiteJobSchema,
  fetchBuildkiteBuild,
  fetchBuildkiteBuilds,
  queryPrometheusVector,
  type BuildkiteBuild,
  type BuildkiteClientConfig,
  type PrometheusClientConfig,
  type TimeWindow,
} from "./ci-io-api.ts";
import { parseCliOptions } from "./ci-io-cli.ts";
import { aggregatePodMetrics } from "./ci-io-aggregate.ts";
import { renderCiIoMarkdown } from "./ci-io-markdown.ts";
import {
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
import type {
  BranchStepIoReport,
  CiIoReport,
  StepIoReport,
  WindowIoReport,
} from "./ci-io-report-model.ts";
import { compareWindows } from "./ci-io-statistics.ts";
import { selectCohortBuilds, selectExplicitBuilds } from "./ci-io-selection.ts";

const WINDOW: TimeWindow = {
  from: new Date("2026-07-20T00:00:00.000Z"),
  to: new Date("2026-07-20T00:10:00.000Z"),
};

const IDS = {
  buildA: "10000000-0000-4000-8000-000000000001",
  buildB: "10000000-0000-4000-8000-000000000002",
  long: "20000000-0000-4000-8000-000000000001",
  short: "20000000-0000-4000-8000-000000000002",
  canceled: "20000000-0000-4000-8000-000000000003",
  canceledBuild: "20000000-0000-4000-8000-000000000004",
} as const;

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

function buildFixture(input: {
  id: string;
  number: number;
  state: string;
  branch: string;
  jobs: unknown[];
}): BuildkiteBuild {
  return BuildkiteBuildSchema.parse({
    id: input.id,
    number: input.number,
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: input.state,
    branch: input.branch,
    created_at: "2026-07-20T00:00:00.000Z",
    started_at: "2026-07-20T00:00:01.000Z",
    finished_at: "2026-07-20T00:09:00.000Z",
    web_url: `https://buildkite.com/sjerred/monorepo/builds/${String(input.number)}`,
    jobs: input.jobs,
  });
}

function jobFixture(input: {
  id: string;
  buildNumber: number;
  name: string;
  stepKey: string;
  state: string;
  startedAt: string;
  finishedAt: string | null;
}): unknown {
  return {
    id: input.id,
    name: input.name,
    step_key: input.stepKey,
    state: input.state,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    web_url: `https://buildkite.com/sjerred/monorepo/builds/${String(input.buildNumber)}#${input.id}`,
    exit_status: input.state === "passed" ? 0 : null,
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

function addPod(input: {
  metrics: PrometheusIoMetrics;
  jobId: string;
  suffix?: string;
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
  const pod = `buildkite-${input.jobId}-${input.suffix ?? "abc12"}`;
  const device = "overlay";
  const node = input.node ?? "ci-node";
  input.metrics.parentMax.push(
    parentMetric({
      pod,
      device,
      value: input.writes,
      node,
      metadata: input.metadata ?? null,
    }),
  );
  input.metrics.parentSamples.push(
    parentMetric({
      pod,
      device,
      value: input.samples,
      node,
      metadata: input.metadata ?? null,
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
      metadata: input.metadata ?? null,
    }),
  );
  input.metrics.childMax.push({
    ...parentMetric({
      pod,
      device,
      value: input.writes,
      node,
      metadata: input.metadata ?? null,
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

function reportBuilds(): BuildkiteBuild[] {
  return [
    buildFixture({
      id: IDS.buildA,
      number: 101,
      state: "passed",
      branch: "feature/io",
      jobs: [
        jobFixture({
          id: IDS.long,
          buildNumber: 101,
          name: "long fixture",
          stepKey: "fixture",
          state: "passed",
          startedAt: "2026-07-20T00:01:00.000Z",
          finishedAt: "2026-07-20T00:02:00.000Z",
        }),
        jobFixture({
          id: IDS.short,
          buildNumber: 101,
          name: "short fixture",
          stepKey: "short",
          state: "passed",
          startedAt: "2026-07-20T00:02:00.000Z",
          finishedAt: "2026-07-20T00:02:20.000Z",
        }),
        jobFixture({
          id: IDS.canceled,
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
      id: IDS.buildB,
      number: 102,
      state: "canceled",
      branch: "main",
      jobs: [
        jobFixture({
          id: IDS.canceledBuild,
          buildNumber: 102,
          name: "fixture in canceled build",
          stepKey: "fixture",
          state: "passed",
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
  addPod({ metrics, jobId: IDS.canceledBuild, writes: 70, samples: 5 });
  return metrics;
}

describe("Prometheus query contract", () => {
  test("selects only unique raw pod-parent cgroups", () => {
    const queries = buildIoQueries(WINDOW, "raw");
    expect(queries.parentMax).toContain('container=""');
    expect(queries.parentMax).toContain('id=~"/kubepods.*pod[^/]+$"');
    expect(queries.parentMax).toContain("max by (pod,node,device)");
    expect(queries.parentLastSample).toContain(
      "max_over_time(timestamp(container_fs_writes_bytes_total",
    );
    expect(queries.parentLastSample).toContain("})[600s:10s])");
    expect(queries.childMax).toContain('container!=""');
    expect(queries.networkReceiveMax).toContain(
      "container_network_receive_bytes_total",
    );
  });

  test("uses the explicit enriched recording-rule contract", () => {
    const queries = buildIoQueries(WINDOW, "recording");
    expect(queries.parentMax).toContain(
      "buildkite:pod_parent_fs_writes_bytes_total",
    );
    expect(queries.parentSamples).toContain(
      "buildkite:pod_parent_sample_present",
    );
    expect(queries.parentLastSample).toContain(
      "timestamp(container_fs_writes_bytes_total",
    );
    expect(queries.childMax).toContain(
      "buildkite:container_fs_writes_bytes_total",
    );
  });

  test("preserves recording-rule devices and enriched metadata", async () => {
    const metadata = {
      pod: `buildkite-${IDS.long}-abc12`,
      node: "torvalds",
      device: "/dev/nvme0n1",
      label_buildkite_com_job_uuid: IDS.long,
      label_ci_sjer_red_step_key: "fixture",
      annotation_buildkite_com_build_branch: "feature/io",
      annotation_buildkite_com_build_url:
        "https://buildkite.com/sjerred/monorepo/builds/101",
      annotation_buildkite_com_job_url: `https://buildkite.com/sjerred/monorepo/builds/101#${IDS.long}`,
      annotation_buildkite_com_pipeline_slug: "monorepo",
    };
    const client: PrometheusClientConfig = {
      apiBaseUrl: "http://prometheus:9090/",
      fetcher: (url) => {
        const query = new URL(url).searchParams.get("query") ?? "";
        const metric = query.includes("container_network_")
          ? {
              pod: metadata.pod,
              node: metadata.node,
              interface: "eth0",
            }
          : query.includes("buildkite:container_fs_writes_bytes_total")
            ? { ...metadata, container: "container-0" }
            : metadata;
        return Promise.resolve(
          Response.json({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric, value: [1, "1"] }],
            },
          }),
        );
      },
    };

    const metrics = await fetchPrometheusIoMetrics({
      client,
      window: WINDOW,
      source: "recording",
    });
    expect(metrics.parentMax[0]?.device).toBe("/dev/nvme0n1");
    expect(metrics.parentMax[0]?.metadata?.stepKey).toBe("fixture");
    expect(metrics.childMax[0]?.device).toBe("/dev/nvme0n1");
  });

  test("preserves cAdvisor series whose device label is absent", async () => {
    const pod = `buildkite-${IDS.long}-abc12`;
    const client: PrometheusClientConfig = {
      apiBaseUrl: "http://prometheus:9090/",
      fetcher: (url) => {
        const query = new URL(url).searchParams.get("query") ?? "";
        const metric = query.includes("container_network_")
          ? { pod, node: "torvalds", interface: "eth0" }
          : query.includes('container!=""')
            ? { pod, node: "torvalds", container: "container-0" }
            : { pod, node: "torvalds" };
        return Promise.resolve(
          Response.json({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric, value: [1, "1"] }],
            },
          }),
        );
      },
    };

    const metrics = await fetchPrometheusIoMetrics({
      client,
      window: WINDOW,
      source: "raw",
    });
    expect(metrics.parentMax[0]?.device).toBeNull();
    expect(metrics.childMax[0]?.device).toBeNull();
    expect(aggregatePodMetrics(metrics)[0]?.writeBytes).toBe(1);
  });
});

describe("validated API clients", () => {
  test("validates Buildkite responses", async () => {
    const build = reportBuilds()[0];
    if (build === undefined) {
      throw new Error("fixture build missing");
    }
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const config: BuildkiteClientConfig = {
      apiBaseUrl: "https://api.buildkite.com/v2/",
      organization: "sjerred",
      pipeline: "monorepo",
      token: "secret-token",
      fetcher: (url, init) => {
        requestedUrl = url;
        requestedInit = init;
        return Promise.resolve(Response.json(build));
      },
    };
    const parsed = await fetchBuildkiteBuild(config, 101);
    expect(parsed.number).toBe(101);
    const url = new URL(requestedUrl);
    expect(url.pathname).toEndWith("/builds/101");
    expect(url.searchParams.get("include_retried_jobs")).toBe("true");
    expect(requestedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(parsed)).not.toContain("secret-token");
  });

  test("lists a created_at cohort with retries and a request deadline", async () => {
    const build = reportBuilds()[0];
    if (build === undefined) {
      throw new Error("fixture build missing");
    }
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const config: BuildkiteClientConfig = {
      apiBaseUrl: "https://api.buildkite.com/v2/",
      organization: "sjerred",
      pipeline: "monorepo",
      token: "secret-token",
      fetcher: (url, init) => {
        requestedUrl = url;
        requestedInit = init;
        return Promise.resolve(Response.json([build]));
      },
    };
    const builds = await fetchBuildkiteBuilds(config, WINDOW);
    expect(builds.map((current) => current.number)).toEqual([101]);
    const url = new URL(requestedUrl);
    expect(url.searchParams.get("created_from")).toBe(
      WINDOW.from.toISOString(),
    );
    expect(url.searchParams.get("created_to")).toBe(WINDOW.to.toISOString());
    expect(url.searchParams.get("include_retried_jobs")).toBe("true");
    expect(requestedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  test("accepts every documented Buildkite job state", () => {
    const states = [
      "pending",
      "waiting",
      "waiting_failed",
      "blocked",
      "blocked_failed",
      "unblocked",
      "unblocked_failed",
      "limiting",
      "limited",
      "scheduled",
      "reserved",
      "assigned",
      "accepted",
      "running",
      "finished",
      "passed",
      "failed",
      "canceling",
      "canceled",
      "expired",
      "timing_out",
      "timed_out",
      "skipped",
      "broken",
      "platform_limiting",
      "platform_limited",
    ];
    for (const state of states) {
      expect(() =>
        BuildkiteJobSchema.parse(
          jobFixture({
            id: IDS.long,
            buildNumber: 101,
            name: "state fixture",
            stepKey: "state-fixture",
            state,
            startedAt: "2026-07-20T00:01:00.000Z",
            finishedAt: "2026-07-20T00:02:00.000Z",
          }),
        ),
      ).not.toThrow();
    }
  });

  test("rejects Buildkite schema drift", async () => {
    const config: BuildkiteClientConfig = {
      apiBaseUrl: "https://api.buildkite.com/v2/",
      organization: "sjerred",
      pipeline: "monorepo",
      token: "secret-token",
      fetcher: () =>
        Promise.resolve(Response.json({ number: 101, state: "unknown" })),
    };
    await expect(fetchBuildkiteBuild(config, 101)).rejects.toThrow();
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
    const unfinished = BuildkiteBuildSchema.parse({
      ...unfinishedSource,
      state: "running",
      finished_at: null,
    });
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
        buildUrl: "https://buildkite.com/sjerred/monorepo/builds/102",
        disposition: "excluded",
      },
    ]);
  });

  test("rejects an explicit selection containing only unfinished builds", () => {
    const source = reportBuilds()[0];
    if (source === undefined) {
      throw new Error("selection fixture build missing");
    }
    const unfinished = BuildkiteBuildSchema.parse({
      ...source,
      state: "running",
      finished_at: null,
    });
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
    const metrics = filterPrometheusIoMetrics(
      reportMetrics(),
      new Set([IDS.long]),
    );
    for (const series of Object.values(metrics)) {
      expect(series.every((metric) => metric.pod.includes(IDS.long))).toBe(
        true,
      );
    }
  });

  test("sums parent devices once and keeps children diagnostic", () => {
    const metrics = reportMetrics();
    const measurements = aggregatePodMetrics(metrics);
    const measurement = measurements.find((item) => item.jobUuid === IDS.long);
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
      pipeline: "monorepo",
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
        pod: `buildkite-${IDS.canceled}-abc12`,
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
      pipeline: "monorepo",
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
    const shortSample = metrics.parentSamples.find((metric) =>
      metric.pod.includes(IDS.short),
    );
    if (shortSample === undefined) {
      throw new Error("short-job sample fixture missing");
    }
    shortSample.value = 2;
    const report = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics,
      pipeline: "monorepo",
      excludedJobIds: new Set(),
    });
    const shortJob = report.jobs.find((job) => job.jobId === IDS.short);
    expect(shortJob?.coverage).toBe("complete");
  });
});

describe("window report integrity", () => {
  test("requires every parent device to be scraped after job completion", () => {
    const metrics = reportMetrics();
    const staleSample = metrics.parentLastSample.find(
      (metric) => metric.pod.includes(IDS.long) && metric.device === "cache",
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
      pipeline: "monorepo",
      excludedJobIds: new Set([IDS.short, IDS.canceled]),
    });
    const job = report.jobs[0];
    expect(job?.coverage).toBe("lower-bound");
    expect(job?.lastParentSampleAt).toBe("2026-07-20T00:01:59.000Z");
    expect(report.integrityIssues).toEqual([
      {
        code: "missing-post-finish-parent-sample",
        message:
          "pod-parent devices do not all have a sample at or after Buildkite finished_at 2026-07-20T00:02:00.000Z",
        jobId: IDS.long,
        pod: `buildkite-${IDS.long}-abc12`,
      },
    ]);
  });

  test("reports a missing last sample for any parent device", () => {
    const metrics = reportMetrics();
    metrics.parentLastSample = metrics.parentLastSample.filter(
      (metric) => !(metric.pod.includes(IDS.long) && metric.device === "cache"),
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
      pipeline: "monorepo",
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
      pipeline: "monorepo",
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
      pipeline: "monorepo",
      excludedJobIds: new Set([IDS.long]),
    });
    expect(report.summary.totalWriteBytes).toBe(130);
    const unmatched = report.integrityIssues.filter(
      (current) =>
        current.code === "unmatched-pod" &&
        current.pod?.includes(IDS.long) === true,
    );
    expect(unmatched).toHaveLength(0);
  });

  test("validates enriched recording metadata against Buildkite", () => {
    const metrics = emptyMetrics();
    const metadata: MetricMetadata = {
      jobUuid: IDS.long,
      stepKey: "wrong-step",
      branch: "feature/io",
      buildUrl: "https://buildkite.com/sjerred/monorepo/builds/101",
      jobUrl: `https://buildkite.com/sjerred/monorepo/builds/101#${IDS.long}`,
      pipeline: "monorepo",
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
      pipeline: "monorepo",
      excludedJobIds: new Set([IDS.short, IDS.canceled]),
    });
    expect(report.integrityIssues.map((current) => current.code)).toContain(
      "metadata-mismatch",
    );
  });
});

function stepFixture(input: {
  writes: number | null;
  duration: number | null;
  network: number | null;
  p95Duration?: number | null;
  p95Network?: number | null;
}): StepIoReport {
  return {
    stepKey: "image-fixture",
    jobCount: 5,
    measuredJobCount: input.writes === null ? 0 : 5,
    completeJobCount: input.writes === null ? 0 : 5,
    lowerBoundJobCount: 0,
    missingJobCount: input.writes === null ? 5 : 0,
    nodeJobCounts: { torvalds: 5 },
    totalWriteBytes: input.writes === null ? 0 : input.writes * 5,
    medianWriteBytes: input.writes,
    p95WriteBytes: input.writes,
    medianDurationSeconds: input.duration,
    p95DurationSeconds:
      input.p95Duration === undefined ? input.duration : input.p95Duration,
    medianNetworkBytes: input.network,
    p95NetworkBytes:
      input.p95Network === undefined ? input.network : input.p95Network,
    canceledBuildWriteBytes: 0,
    canceledJobWriteBytes: 0,
  };
}

const MAIN_FIXED_CORPUS_STEP_KEYS = [
  "verify",
  "playwright-e2e-main",
  "resume-build-main",
  "docker-e2e-main",
  "images",
  "tofu-apply",
] as const;

const PR_FIXED_CORPUS_STEP_KEYS = [
  "verify",
  "playwright-e2e-pr",
  "resume-build-pr",
  "docker-e2e-pr",
  "images-pr",
  "tofu-plan",
] as const;

const LEGACY_FIXED_CORPUS_STEP_KEYS = [
  "verify",
  "e2e",
  "resume-build",
  "docker-e2e",
  "images",
  "tofu-apply",
] as const;

function gateWindow(
  step: StepIoReport,
  stepKeys: readonly string[] = MAIN_FIXED_CORPUS_STEP_KEYS,
): WindowIoReport {
  const steps = stepKeys.map((stepKey) => ({ ...step, stepKey }));
  const jobCount = steps.reduce(
    (total, current) => total + current.jobCount,
    0,
  );
  const totalWriteBytes = steps.reduce(
    (total, current) => total + current.totalWriteBytes,
    0,
  );
  return {
    cohort: null,
    from: WINDOW.from.toISOString(),
    to: WINDOW.to.toISOString(),
    buildNumbers: [1],
    unfinishedBuilds: [],
    jobs: [],
    steps,
    branchSteps: steps.map((current) => ({ branch: "main", ...current })),
    summary: {
      buildCount: 1,
      expectedJobCount: jobCount,
      measuredJobCount: jobCount,
      completeJobCount: jobCount,
      lowerBoundJobCount: 0,
      missingJobCount: 0,
      networkMeasuredJobCount: jobCount,
      unfinishedBuildCount: 0,
      excludedBuildCount: 0,
      sampleCoveragePercent: 100,
      p95DurationSeconds: step.p95DurationSeconds,
      totalWriteBytes,
      lowerBoundWriteBytes: 0,
      unmatchedWriteBytes: 0,
      canceledBuildWriteBytes: 0,
      canceledJobWriteBytes: 0,
      totalNetworkReceiveBytes: 0,
      totalNetworkTransmitBytes: 0,
      componentWriteBytes: {},
      componentWriteShares: {},
    },
    integrityIssues: [],
  };
}

function gateLane(report: WindowIoReport, stepKey: string): BranchStepIoReport {
  const lane = report.branchSteps.find(
    (current) => current.stepKey === stepKey,
  );
  if (lane === undefined) {
    throw new Error(`fixed-corpus lane ${stepKey} is missing`);
  }
  return lane;
}

function withoutGateLane(
  report: WindowIoReport,
  stepKey: string,
): WindowIoReport {
  const steps = report.steps.filter((step) => step.stepKey !== stepKey);
  const branchSteps = report.branchSteps.filter(
    (step) => step.stepKey !== stepKey,
  );
  const jobCount = steps.reduce(
    (total, current) => total + current.jobCount,
    0,
  );
  const totalWriteBytes = steps.reduce(
    (total, current) => total + current.totalWriteBytes,
    0,
  );
  return {
    ...report,
    steps,
    branchSteps,
    summary: {
      ...report.summary,
      expectedJobCount: jobCount,
      measuredJobCount: jobCount,
      completeJobCount: jobCount,
      networkMeasuredJobCount: jobCount,
      totalWriteBytes,
    },
  };
}

describe("fixed-corpus impact gate", () => {
  test("passes 50% aggregate write reduction with at most 10% p95 regression", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 110, network: 100 }),
    );
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("passed");
    expect(gate.aggregateWriteReductionPercent).toBe(50);
    expect(gate.p95DurationChangePercent).toBeCloseTo(10);
    expect(gate.baselineLanes.map((lane) => lane.stepKey)).toEqual([
      "docker-e2e",
      "images",
      "resume",
      "sjer.red",
      "tofu",
      "verify",
    ]);
  });

  test("accepts the PR variants of every required validation lane", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
      PR_FIXED_CORPUS_STEP_KEYS,
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
      PR_FIXED_CORPUS_STEP_KEYS,
    );
    expect(compareWindows(baseline, candidate).fixedCorpusGate.status).toBe(
      "passed",
    );
  });

  test("compares legacy baseline keys with current logical lanes", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
      [...LEGACY_FIXED_CORPUS_STEP_KEYS, "legacy-unrelated-step"],
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
      [...MAIN_FIXED_CORPUS_STEP_KEYS, "ci-selector-base"],
    );
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("passed");
    expect(gate.baselineLanes).toEqual(gate.candidateLanes);
    expect(gate.baselineLanes.map((lane) => lane.stepKey)).toEqual([
      "docker-e2e",
      "images",
      "resume",
      "sjer.red",
      "tofu",
      "verify",
    ]);
  });

  test("rejects a window that mixes legacy and current lane keys", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
      [...LEGACY_FIXED_CORPUS_STEP_KEYS, "playwright-e2e-main"],
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("inconclusive");
    expect(gate.reasons).toContain(
      "baseline fixed-corpus window mixes pipeline schemas for logical lanes: main / sjer.red",
    );
  });
});

describe("fixed-corpus threshold guards", () => {
  test("does not count unmapped workload changes toward corpus savings", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
      [...MAIN_FIXED_CORPUS_STEP_KEYS, "legacy-unrelated-step"],
    );
    const candidate = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
      [...MAIN_FIXED_CORPUS_STEP_KEYS, "ci-selector-base"],
    );
    gateLane(baseline, "legacy-unrelated-step").totalWriteBytes = 1000;
    baseline.summary.totalWriteBytes = 1600;
    gateLane(candidate, "ci-selector-base").totalWriteBytes = 0;
    candidate.summary.totalWriteBytes = 600;

    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.aggregateWriteReductionPercent).toBe(0);
    expect(gate.status).toBe("failed");
    expect(gate.reasons).toContain("aggregate write reduction is below 50%");
  });

  test("fails fixed-corpus write and p95 duration thresholds", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 51, duration: 111, network: 100 }),
    );
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("failed");
    expect(gate.reasons).toContain("aggregate write reduction is below 50%");
    expect(gate.reasons).toContain(
      "p95 duration regression exceeds 10% for lane main / images (11.0%)",
    );
    expect(
      gate.reasons.filter((reason) =>
        reason.startsWith("p95 duration regression exceeds 10% for lane"),
      ),
    ).toHaveLength(MAIN_FIXED_CORPUS_STEP_KEYS.length);
  });

  test("rejects matching windows that both omit a required lane", () => {
    const baseline = withoutGateLane(
      gateWindow(stepFixture({ writes: 100, duration: 100, network: 100 })),
      "docker-e2e-main",
    );
    const candidate = withoutGateLane(
      gateWindow(stepFixture({ writes: 50, duration: 100, network: 100 })),
      "docker-e2e-main",
    );
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("inconclusive");
    expect(gate.reasons).not.toContain(
      "fixed-corpus lanes differ between comparison windows",
    );
    expect(gate.reasons).toContain(
      "baseline fixed-corpus window is missing required validation lanes: LLM Docker E2E",
    );
    expect(gate.reasons).toContain(
      "candidate fixed-corpus window is missing required validation lanes: LLM Docker E2E",
    );
  });

  test("fails a per-lane p95 regression hidden by the aggregate p95", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    gateLane(candidate, "images").p95DurationSeconds = 111;
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.p95DurationChangePercent).toBe(0);
    expect(gate.status).toBe("failed");
    expect(gate.reasons).toContain(
      "p95 duration regression exceeds 10% for lane main / images (11.0%)",
    );
  });

  test("makes a missing per-lane p95 inconclusive", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    gateLane(candidate, "images").p95DurationSeconds = null;
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("inconclusive");
    expect(gate.reasons).toContain(
      "p95 duration change could not be calculated for lane main / images",
    );
  });

  test("requires exact lanes, counts, and complete telemetry", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const missingLane = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    missingLane.branchSteps = [];
    expect(
      compareWindows(baseline, missingLane).fixedCorpusGate.reasons,
    ).toContain("fixed-corpus lanes differ between comparison windows");

    const wrongCount = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    const candidateLane = wrongCount.branchSteps[0];
    if (candidateLane === undefined) {
      throw new Error("fixed-corpus lane fixture missing");
    }
    candidateLane.jobCount = 4;
    expect(
      compareWindows(baseline, wrongCount).fixedCorpusGate.reasons,
    ).toContain(
      "fixed-corpus lane job counts differ between comparison windows",
    );

    const incomplete = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    incomplete.summary.completeJobCount -= 1;
    incomplete.summary.lowerBoundJobCount = 1;
    incomplete.summary.unfinishedBuildCount = 1;
    incomplete.summary.excludedBuildCount = 1;
    incomplete.unfinishedBuilds = [
      {
        buildNumber: 2,
        branch: "main",
        state: "running",
        createdAt: WINDOW.from.toISOString(),
        buildUrl: "https://buildkite.com/sjerred/monorepo/builds/2",
        disposition: "excluded",
      },
    ];
    const gate = compareWindows(baseline, incomplete).fixedCorpusGate;
    expect(gate.status).toBe("inconclusive");
    expect(gate.reasons).toContain(
      "one or both fixed-corpus windows have incomplete telemetry",
    );
    expect(gate.reasons).toContain(
      "one or both fixed-corpus cohorts excluded unfinished builds",
    );
  });
});

describe("outputs and CLI", () => {
  test("renders Markdown without client credentials", () => {
    const candidate = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics: reportMetrics(),
      pipeline: "monorepo",
      excludedJobIds: new Set(),
      cohort: {
        createdFrom: WINDOW.from.toISOString(),
        createdTo: WINDOW.to.toISOString(),
      },
    });
    const report: CiIoReport = {
      schemaVersion: 2,
      generatedAt: WINDOW.to.toISOString(),
      metricSource: "raw",
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
    expect(markdown).toContain("Per-branch step distribution");
    expect(markdown).toContain("| Build | Branch | Step | Nodes |");
    expect(markdown).toContain("feature/io");
    expect(markdown).toContain("main");
    expect(markdown).toContain("Last parent sample");
    expect(markdown).toContain("ci-node");
    expect(markdown).toContain("2026-07-20T00:10:00.000Z");
    expect(markdown).not.toContain("secret-token");
  });

  test("parses explicit builds and requires a baseline for impact gates", () => {
    const parsed = parseCliOptions([
      "--build",
      "101,102",
      "--metrics-source",
      "raw",
      "--benchmark",
    ]);
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
