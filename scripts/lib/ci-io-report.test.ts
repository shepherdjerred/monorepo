import { describe, expect, test } from "bun:test";

import { parseCliOptions } from "../ci-io-report.ts";
import {
  BuildkiteBuildSchema,
  fetchBuildkiteBuild,
  queryPrometheusVector,
  type BuildkiteBuild,
  type BuildkiteClientConfig,
  type PrometheusClientConfig,
  type TimeWindow,
} from "./ci-io-api.ts";
import { aggregatePodMetrics } from "./ci-io-aggregate.ts";
import { renderCiIoMarkdown } from "./ci-io-markdown.ts";
import {
  buildIoQueries,
  type DeviceMetric,
  type MetricMetadata,
  type NetworkMetric,
  type PrometheusIoMetrics,
} from "./ci-io-prometheus.ts";
import {
  assertBenchmarkIntegrity,
  buildWindowIoReport,
} from "./ci-io-report.ts";
import type {
  CiIoReport,
  StepIoReport,
  WindowIoReport,
} from "./ci-io-report-model.ts";
import { compareWindows } from "./ci-io-statistics.ts";

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
  device: string;
  value: number;
  metadata?: MetricMetadata | null;
}): DeviceMetric {
  return {
    pod: input.pod,
    node: "ci-node",
    device: input.device,
    value: input.value,
    metadata: input.metadata ?? null,
  };
}

function networkMetric(
  pod: string,
  networkInterface: string,
  value: number,
): NetworkMetric {
  return { pod, node: "ci-node", networkInterface, value };
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
  container?: string;
  metadata?: MetricMetadata | null;
}): string {
  const pod = `buildkite-${input.jobId}-${input.suffix ?? "abc12"}`;
  const device = "overlay";
  input.metrics.parentMax.push(
    parentMetric({
      pod,
      device,
      value: input.writes,
      metadata: input.metadata ?? null,
    }),
  );
  input.metrics.parentSamples.push(
    parentMetric({
      pod,
      device,
      value: input.samples,
      metadata: input.metadata ?? null,
    }),
  );
  input.metrics.parentResets.push(
    parentMetric({
      pod,
      device,
      value: input.resets ?? 0,
      metadata: input.metadata ?? null,
    }),
  );
  input.metrics.childMax.push({
    ...parentMetric({
      pod,
      device,
      value: input.writes,
      metadata: input.metadata ?? null,
    }),
    container: input.container ?? "container-0",
  });
  input.metrics.networkReceiveMax.push(
    networkMetric(pod, "eth0", input.receive ?? 10),
  );
  input.metrics.networkTransmitMax.push(
    networkMetric(pod, "eth0", input.transmit ?? 20),
  );
  input.metrics.networkReceiveResets.push(networkMetric(pod, "eth0", 0));
  input.metrics.networkTransmitResets.push(networkMetric(pod, "eth0", 0));
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
      branch: "feature/io",
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
    expect(queries.childMax).toContain(
      "buildkite:container_fs_writes_bytes_total",
    );
  });
});

describe("validated API clients", () => {
  test("validates Buildkite responses", async () => {
    const build = reportBuilds()[0];
    if (build === undefined) {
      throw new Error("fixture build missing");
    }
    let requestedUrl = "";
    const config: BuildkiteClientConfig = {
      apiBaseUrl: "https://api.buildkite.com/v2/",
      organization: "sjerred",
      pipeline: "monorepo",
      token: "secret-token",
      fetcher: (url) => {
        requestedUrl = url;
        return Promise.resolve(Response.json(build));
      },
    };
    const parsed = await fetchBuildkiteBuild(config, 101);
    expect(parsed.number).toBe(101);
    expect(requestedUrl).toEndWith("/builds/101");
    expect(JSON.stringify(parsed)).not.toContain("secret-token");
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
    const success: PrometheusClientConfig = {
      apiBaseUrl: "http://prometheus:9090/",
      fetcher: () =>
        Promise.resolve(
          Response.json({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric: { pod: "pod" }, value: [1, "42"] }],
            },
          }),
        ),
    };
    const vector = await queryPrometheusVector(success, "up", WINDOW.to);
    expect(vector[0]?.value[1]).toBe("42");

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

describe("pod aggregation", () => {
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
}): StepIoReport {
  return {
    stepKey: "image-fixture",
    jobCount: 5,
    measuredJobCount: input.writes === null ? 0 : 5,
    completeJobCount: input.writes === null ? 0 : 5,
    lowerBoundJobCount: 0,
    missingJobCount: input.writes === null ? 5 : 0,
    totalWriteBytes: input.writes === null ? 0 : input.writes * 5,
    medianWriteBytes: input.writes,
    p95WriteBytes: input.writes,
    medianDurationSeconds: input.duration,
    p95DurationSeconds: input.duration,
    medianNetworkBytes: input.network,
    p95NetworkBytes: input.network,
    canceledBuildWriteBytes: 0,
    canceledJobWriteBytes: 0,
  };
}

function gateWindow(step: StepIoReport): WindowIoReport {
  return {
    from: WINDOW.from.toISOString(),
    to: WINDOW.to.toISOString(),
    buildNumbers: [1],
    jobs: [],
    steps: [step],
    summary: {
      buildCount: 1,
      expectedJobCount: 5,
      measuredJobCount: 5,
      completeJobCount: 5,
      lowerBoundJobCount: 0,
      missingJobCount: 0,
      networkMeasuredJobCount: 5,
      sampleCoveragePercent: 100,
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
});

describe("outputs and CLI", () => {
  test("renders Markdown without client credentials", () => {
    const candidate = buildWindowIoReport({
      builds: reportBuilds(),
      window: WINDOW,
      metrics: reportMetrics(),
      pipeline: "monorepo",
      excludedJobIds: new Set(),
    });
    const report: CiIoReport = {
      schemaVersion: 1,
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
    expect(markdown).not.toContain("secret-token");
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
    expect(() =>
      parseCliOptions([
        "--from",
        WINDOW.from.toISOString(),
        "--to",
        WINDOW.to.toISOString(),
        "--enforce-ab-gates",
      ]),
    ).toThrow("--enforce-ab-gates requires a baseline window");
  });
});
