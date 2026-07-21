import { describe, expect, test } from "bun:test";

import {
  assertEquivalentAbSelections,
  postFixtureScrapeWaitMilliseconds,
} from "../ci-io-report.ts";
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

  test("labels the unfinished current build allowed by Docker A/B", () => {
    const source = reportBuilds()[0];
    if (source === undefined) {
      throw new Error("selection fixture build missing");
    }
    const unfinished = BuildkiteBuildSchema.parse({
      ...source,
      state: "running",
      finished_at: null,
    });
    const selection = selectExplicitBuilds({
      builds: [unfinished],
      now: WINDOW.to,
      allowUnfinishedDockerAb: true,
    });
    expect(selection.builds.map((build) => build.number)).toEqual([101]);
    expect(selection.unfinishedBuilds[0]?.disposition).toBe(
      "included-docker-ab",
    );
    expect(() =>
      selectExplicitBuilds({
        builds: [unfinished],
        now: WINDOW.to,
        allowUnfinishedDockerAb: false,
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
    p95DurationSeconds: input.p95Duration ?? input.duration,
    medianNetworkBytes: input.network,
    p95NetworkBytes: input.p95Network ?? input.network,
    canceledBuildWriteBytes: 0,
    canceledJobWriteBytes: 0,
  };
}

function gateWindow(step: StepIoReport): WindowIoReport {
  return {
    cohort: null,
    from: WINDOW.from.toISOString(),
    to: WINDOW.to.toISOString(),
    buildNumbers: [1],
    unfinishedBuilds: [],
    jobs: [],
    steps: [step],
    branchSteps: [{ branch: "main", ...step }],
    summary: {
      buildCount: 1,
      expectedJobCount: 5,
      measuredJobCount: 5,
      completeJobCount: 5,
      lowerBoundJobCount: 0,
      missingJobCount: 0,
      networkMeasuredJobCount: 5,
      unfinishedBuildCount: 0,
      excludedBuildCount: 0,
      sampleCoveragePercent: 100,
      p95DurationSeconds: step.p95DurationSeconds,
      totalWriteBytes: step.totalWriteBytes,
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

describe("A/B comparison gates", () => {
  test("passes 20% per-fixture, 30% geometric mean, and 10% regression gates", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 60, duration: 105, network: 105 }),
    );
    const comparison = compareWindows(
      baseline,
      candidate,
      new Set(["image-fixture"]),
    );
    expect(comparison.gates.status).toBe("passed");
    expect(comparison.gates.geometricMeanWriteReductionPercent).toBeCloseTo(40);
  });

  test("fails threshold regressions and marks missing metrics inconclusive", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const failed = gateWindow(
      stepFixture({ writes: 85, duration: 111, network: 111 }),
    );
    expect(
      compareWindows(baseline, failed, new Set(["image-fixture"])).gates.status,
    ).toBe("failed");

    const missing = gateWindow(
      stepFixture({ writes: 60, duration: 105, network: null }),
    );
    expect(
      compareWindows(baseline, missing, new Set(["image-fixture"])).gates
        .status,
    ).toBe("inconclusive");
  });

  test("uses p95 regressions and rejects mismatched or incomplete workloads", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const p95Regression = gateWindow(
      stepFixture({
        writes: 60,
        duration: 100,
        network: 100,
        p95Duration: 111,
      }),
    );
    expect(
      compareWindows(baseline, p95Regression, new Set(["image-fixture"])).gates
        .status,
    ).toBe("failed");

    const incompleteStep = stepFixture({
      writes: 60,
      duration: 100,
      network: 100,
    });
    incompleteStep.completeJobCount = 4;
    incompleteStep.lowerBoundJobCount = 1;
    const incomplete = compareWindows(
      baseline,
      gateWindow(incompleteStep),
      new Set(["image-fixture"]),
    );
    expect(incomplete.gates.status).toBe("inconclusive");
    expect(incomplete.gates.fixtures[0]?.reasons).toContain(
      "fixture includes missing or lower-bound telemetry",
    );

    const mismatchedStep = stepFixture({
      writes: 60,
      duration: 100,
      network: 100,
    });
    mismatchedStep.jobCount = 4;
    const mismatched = compareWindows(
      baseline,
      gateWindow(mismatchedStep),
      new Set(["image-fixture"]),
    );
    expect(mismatched.gates.status).toBe("inconclusive");
    expect(mismatched.gates.fixtures[0]?.reasons).toContain(
      "fixture job counts differ between comparison windows",
    );
  });

  test("marks fixture placement changes inconclusive", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidateStep = stepFixture({
      writes: 60,
      duration: 100,
      network: 100,
    });
    candidateStep.nodeJobCounts = { grace: 1, torvalds: 4 };
    const comparison = compareWindows(
      baseline,
      gateWindow(candidateStep),
      new Set(["image-fixture"]),
    );
    expect(comparison.gates.status).toBe("inconclusive");
    expect(comparison.gates.fixtures[0]?.reasons).toContain(
      "fixture node placement differs between comparison windows",
    );
  });
});

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
    expect(gate.baselineLanes).toEqual([
      { branch: "main", stepKey: "image-fixture", jobCount: 5 },
    ]);
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
    expect(gate.reasons).toEqual([
      "aggregate write reduction is below 50%",
      "p95 duration regression exceeds 10%",
    ]);
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
    incomplete.summary.completeJobCount = 4;
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
      comparisonProfile: "docker-ab",
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

  test("bounds the enforced A/B post-fixture scrape grace", () => {
    const builds = reportBuilds();
    expect(
      postFixtureScrapeWaitMilliseconds(
        builds,
        ["fixture"],
        new Date("2026-07-20T00:04:50.000Z"),
      ),
    ).toBe(20_000);
    expect(
      postFixtureScrapeWaitMilliseconds(
        builds,
        ["fixture"],
        new Date("2026-07-20T00:05:05.000Z"),
      ),
    ).toBe(15_000);
    expect(
      postFixtureScrapeWaitMilliseconds(
        builds,
        ["fixture"],
        new Date("2026-07-20T00:05:20.000Z"),
      ),
    ).toBe(0);
    expect(
      postFixtureScrapeWaitMilliseconds(
        builds,
        ["missing-step"],
        new Date("2026-07-20T00:05:05.000Z"),
      ),
    ).toBe(0);
  });

  test("parses explicit builds and requires explicit fixtures for A/B gates", () => {
    const parsed = parseCliOptions([
      "--build",
      "101,102",
      "--metrics-source",
      "raw",
      "--benchmark",
    ]);
    expect(parsed.buildNumbers).toEqual([101, 102]);
    expect(parsed.benchmark).toBe(true);
    expect(parsed.comparisonProfile).toBe("docker-ab");
    const exactAb = parseCliOptions([
      "--build",
      "102",
      "--baseline-build",
      "101",
      "--fixture-step",
      "image-fixture",
      "--enforce-ab-gates",
    ]);
    expect(exactAb.baselineBuildNumbers).toEqual([101]);
    expect(exactAb.enforceAbGates).toBe(true);
    const fixedCorpus = parseCliOptions([
      "--build",
      "102",
      "--baseline-build",
      "101",
      "--comparison-profile",
      "fixed-corpus",
      "--enforce-ab-gates",
    ]);
    expect(fixedCorpus.comparisonProfile).toBe("fixed-corpus");
    expect(fixedCorpus.fixtureSteps).toEqual([]);
    expect(() =>
      parseCliOptions([
        "--from",
        WINDOW.from.toISOString(),
        "--to",
        WINDOW.to.toISOString(),
        "--enforce-ab-gates",
      ]),
    ).toThrow("--enforce-ab-gates requires a baseline selection");
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
    expect(() =>
      parseCliOptions([
        "--build",
        "102",
        "--comparison-profile",
        "fixed-corpus",
      ]),
    ).toThrow("fixed-corpus requires a baseline selection");
    expect(() =>
      parseCliOptions(["--build", "102", "--comparison-profile", "unknown"]),
    ).toThrow();
  });

  test("requires A/B selections to use one identical commit", () => {
    const baseline = reportBuilds().map((build) => ({
      ...build,
      number: build.number + 100,
    }));
    const candidate = reportBuilds();
    expect(() =>
      assertEquivalentAbSelections(baseline, candidate),
    ).not.toThrow();
    const firstCandidate = candidate[0];
    if (firstCandidate === undefined) {
      throw new Error("candidate fixture is missing");
    }
    firstCandidate.commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(() => assertEquivalentAbSelections(baseline, candidate)).toThrow(
      "A/B builds must use one identical commit",
    );
    expect(() => assertEquivalentAbSelections(candidate, candidate)).toThrow(
      "A/B build selections must be disjoint",
    );
  });
});
