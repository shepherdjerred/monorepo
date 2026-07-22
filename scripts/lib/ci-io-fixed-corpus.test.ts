import { describe, expect, test } from "bun:test";

import type { TimeWindow } from "./ci-io-api.ts";
import { renderCiIoMarkdown } from "./ci-io-markdown.ts";
import type {
  BranchStepIoReport,
  CiIoReport,
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
    selectedBuilds: [
      {
        buildNumber: 1,
        branch: "main",
        commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        buildUrl: "https://buildkite.com/sjerred/monorepo/builds/1",
      },
    ],
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

function distributeGateJobsAcrossTwoBuilds(
  report: WindowIoReport,
  buildNumberFor: (laneIndex: number, jobIndex: number) => number,
): void {
  report.buildNumbers = [1, 2];
  report.selectedBuilds.push({
    buildNumber: 2,
    branch: "main",
    commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    buildUrl: "https://buildkite.com/sjerred/monorepo/builds/2",
  });
  report.summary.buildCount = 2;
  const jobsById = new Map(report.jobs.map((job) => [job.jobId, job]));
  report.jobOutcomes.forEach((outcome, index) => {
    const laneIndex = Math.floor(index / 5);
    const jobIndex = index % 5;
    const buildNumber = buildNumberFor(laneIndex, jobIndex);
    outcome.buildNumber = buildNumber;
    const job = jobsById.get(outcome.jobId);
    if (job === undefined) {
      throw new Error(`fixed-corpus job report ${outcome.jobId} is missing`);
    }
    job.buildNumber = buildNumber;
    job.buildUrl = `https://buildkite.com/sjerred/monorepo/builds/${String(buildNumber)}`;
  });
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
    expect(gate.baselineBuilds[0]?.workloadSignature).toBe(
      gate.candidateBuilds[0]?.workloadSignature,
    );
  });

  test("preserves differing commits for audit without comparing them", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    const baselineBuild = baseline.selectedBuilds[0];
    const candidateBuild = candidate.selectedBuilds[0];
    if (baselineBuild === undefined || candidateBuild === undefined) {
      throw new Error("fixed-corpus selected build fixture is missing");
    }
    baselineBuild.commit = "baseline-commit";
    candidateBuild.commit = "candidate-commit";

    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("passed");
    expect(gate.baselineBuilds.map((build) => build.commit)).toEqual([
      "baseline-commit",
    ]);
    expect(gate.candidateBuilds.map((build) => build.commit)).toEqual([
      "candidate-commit",
    ]);
    expect(gate.baselineBuilds[0]?.workloadSignature).toBe(
      "docker-e2e=5,images=5,resume=5,sjer.red=5,tofu=5,verify=5",
    );
    const report: CiIoReport = {
      schemaVersion: 3,
      generatedAt: WINDOW.to.toISOString(),
      metricSource: "recording",
      organization: "sjerred",
      pipeline: "monorepo",
      candidate,
      baseline,
      comparison: compareWindows(baseline, candidate),
    };
    const markdown = renderCiIoMarkdown(report);
    expect(markdown).toContain("### Fixed-corpus build identities");
    expect(markdown).toContain("`baseline-commit`");
    expect(markdown).toContain("`candidate-commit`");
    expect(markdown).toContain(
      "`docker-e2e=5,images=5,resume=5,sjer.red=5,tofu=5,verify=5`",
    );
  });

  test("requires matching per-build workload signature multisets", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    distributeGateJobsAcrossTwoBuilds(baseline, (_laneIndex, jobIndex) =>
      jobIndex === 4 ? 2 : 1,
    );
    distributeGateJobsAcrossTwoBuilds(candidate, (laneIndex) =>
      laneIndex < 3 ? 1 : 2,
    );

    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("inconclusive");
    expect(gate.reasons).toContain(
      "fixed-corpus per-build workload signature multisets differ between comparison windows",
    );
    expect(gate.reasons).not.toContain(
      "fixed-corpus lane job counts differ between comparison windows",
    );
    expect(gate.baselineBuilds.map((build) => build.workloadSignature)).toEqual(
      [
        "docker-e2e=4,images=4,resume=4,sjer.red=4,tofu=4,verify=4",
        "docker-e2e=1,images=1,resume=1,sjer.red=1,tofu=1,verify=1",
      ],
    );
    expect(
      gate.candidateBuilds.map((build) => build.workloadSignature),
    ).toEqual(["resume=5,sjer.red=5,verify=5", "docker-e2e=5,images=5,tofu=5"]);
  });

  test("compares per-build workload signatures as a multiset", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    distributeGateJobsAcrossTwoBuilds(baseline, (_laneIndex, jobIndex) =>
      jobIndex === 4 ? 2 : 1,
    );
    distributeGateJobsAcrossTwoBuilds(candidate, (_laneIndex, jobIndex) =>
      jobIndex === 0 ? 1 : 2,
    );

    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.baselineBuilds[0]?.workloadSignature).not.toBe(
      gate.candidateBuilds[0]?.workloadSignature,
    );
    expect(gate.status).toBe("passed");
    expect(gate.reasons).not.toContain(
      "fixed-corpus per-build workload signature multisets differ between comparison windows",
    );
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

  test("detects legacy and current physical schemas across branches", () => {
    const baseline = gateWindow(
      stepFixture({ writes: 100, duration: 100, network: 100 }),
      [...LEGACY_FIXED_CORPUS_STEP_KEYS, "playwright-e2e-main"],
    );
    const candidate = gateWindow(
      stepFixture({ writes: 50, duration: 100, network: 100 }),
    );
    const legacyAliases = new Set(["e2e", "resume-build", "docker-e2e"]);
    for (const lane of baseline.branchSteps) {
      if (legacyAliases.has(lane.stepKey)) {
        lane.branch = "legacy-branch";
      }
    }
    for (const job of baseline.jobOutcomes) {
      if (legacyAliases.has(job.stepKey)) {
        job.branch = "legacy-branch";
      }
    }

    const gate = compareWindows(baseline, candidate).fixedCorpusGate;
    expect(gate.status).toBe("inconclusive");
    expect(gate.reasons).toContain(
      "baseline fixed-corpus window mixes legacy and current physical pipeline schemas: legacy aliases docker-e2e, e2e, resume-build and current aliases playwright-e2e-main",
    );
    expect(gate.reasons).not.toContain(
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
