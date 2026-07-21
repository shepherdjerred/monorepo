import { describe, expect, test } from "bun:test";

import type { TimeWindow } from "./ci-io-api.ts";
import type {
  BranchStepIoReport,
  JobIoReport,
  JobOutcomeReport,
  StepIoReport,
  WindowIoReport,
} from "./ci-io-report-model.ts";
import { compareWindows } from "./ci-io-statistics.ts";

const WINDOW: TimeWindow = {
  from: new Date("2026-07-20T00:00:00.000Z"),
  to: new Date("2026-07-20T00:10:00.000Z"),
};

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
  const jobs = steps.flatMap((current, laneIndex) =>
    Array.from(
      { length: current.jobCount },
      (_, jobIndex): JobIoReport => ({
        buildNumber: 1,
        buildState: "passed",
        buildUrl: "https://buildkite.com/sjerred/monorepo/builds/1",
        branch: "main",
        jobId: `gate-${laneIndex.toString()}-${jobIndex.toString()}`,
        jobName: `${current.stepKey} fixture`,
        jobState: "passed",
        jobUrl: `https://buildkite.com/sjerred/monorepo/builds/1#gate-${laneIndex.toString()}-${jobIndex.toString()}`,
        stepKey: current.stepKey,
        pods: [`gate-${laneIndex.toString()}-${jobIndex.toString()}`],
        nodes: ["torvalds"],
        durationSeconds: current.medianDurationSeconds ?? 0,
        finished: true,
        coverage: "complete",
        sampleCount: 2,
        lastParentSampleAt: WINDOW.to.toISOString(),
        writeBytes: current.totalWriteBytes / current.jobCount,
        networkReceiveBytes: 0,
        networkTransmitBytes: 0,
        componentWriteBytes: {},
      }),
    ),
  );
  const jobOutcomes: JobOutcomeReport[] = jobs.map((job) => ({
    buildNumber: job.buildNumber,
    buildState: job.buildState,
    branch: job.branch,
    jobId: job.jobId,
    jobName: job.jobName,
    jobState: job.jobState,
    stepKey: job.stepKey,
    started: true,
  }));
  return {
    cohort: null,
    from: WINDOW.from.toISOString(),
    to: WINDOW.to.toISOString(),
    buildNumbers: [1],
    unfinishedBuilds: [],
    jobOutcomes,
    jobs,
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

function gateJob(report: WindowIoReport, stepKey: string): JobOutcomeReport {
  const job = report.jobOutcomes.find((current) => current.stepKey === stepKey);
  if (job === undefined) {
    throw new Error(`fixed-corpus job ${stepKey} is missing`);
  }
  return job;
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
    jobOutcomes: report.jobOutcomes.filter(
      (outcome) => outcome.stepKey !== stepKey,
    ),
    jobs: report.jobs.filter((job) => job.stepKey !== stepKey),
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

  test("makes failed, canceled, or unstarted required jobs inconclusive", () => {
    for (const outcome of [
      { state: "failed", started: true },
      { state: "canceled", started: true },
      { state: "not_run", started: false },
    ]) {
      const baseline = gateWindow(
        stepFixture({ writes: 100, duration: 100, network: 100 }),
      );
      const candidate = gateWindow(
        stepFixture({ writes: 50, duration: 100, network: 100 }),
      );
      const job = gateJob(candidate, "images");
      job.jobState = outcome.state;
      job.started = outcome.started;
      const gate = compareWindows(baseline, candidate).fixedCorpusGate;
      expect(gate.status).toBe("inconclusive");
      expect(gate.reasons).toContain(
        `candidate fixed-corpus jobs did not all pass: #1 main / images gate-4-0 (${outcome.state})`,
      );
    }
  });

  test("ignores unsuccessful jobs outside the fixed corpus", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    candidate.jobOutcomes.push({
      buildNumber: 1,
      buildState: "failed",
      branch: "main",
      jobId: "unmapped-failure",
      jobName: "scanner",
      jobState: "failed",
      stepKey: "semgrep",
      started: true,
    });
    expect(compareWindows(baseline, candidate).fixedCorpusGate.status).toBe(
      "passed",
    );
  });

  test("ignores unstarted broken aliases from false step conditions", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    candidate.jobOutcomes.push({
      buildNumber: 1,
      buildState: "passed",
      branch: "main",
      jobId: "inactive-pr-image-lane",
      jobName: "images PR",
      jobState: "broken",
      stepKey: "images-pr",
      started: false,
    });
    expect(compareWindows(baseline, candidate).fixedCorpusGate.status).toBe(
      "passed",
    );
  });

  test("does not ignore an unstarted broken active alias", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    const job = gateJob(candidate, "images");
    job.jobState = "broken";
    job.started = false;
    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("inconclusive");
    expect(gate.reasons).toContain(
      "candidate fixed-corpus jobs did not all pass: #1 main / images gate-4-0 (broken)",
    );
  });
});

describe("fixed-corpus completeness guards", () => {
  test("allows canceled builds when every mapped validation job passed", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    for (const outcome of candidate.jobOutcomes) {
      outcome.buildState = "canceled";
    }
    expect(compareWindows(baseline, candidate).fixedCorpusGate.status).toBe(
      "passed",
    );
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

    const missingJobRecord = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    missingJobRecord.jobOutcomes.shift();
    expect(
      compareWindows(baseline, missingJobRecord).fixedCorpusGate.reasons,
    ).toContain(
      "candidate fixed-corpus job records do not match lane counts: main / verify expected 5, found 4",
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
