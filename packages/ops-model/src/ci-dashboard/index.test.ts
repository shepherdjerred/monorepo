import { describe, expect, test } from "vitest";
import {
  CiDashboardSampleSchema,
  ciRunKey,
  ciTimingAttempt,
  ciWorkflowKey,
  estimateCiDashboard,
  type CiDashboardSample,
  type CiRun,
  type CiTimingHistory,
  type CiWorkflow,
} from "./index.ts";

const now = new Date("2026-11-26T20:00:00.000Z");

function at(seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function workflow(
  name: string,
  state: string,
  start?: number,
  end?: number,
): CiWorkflow {
  return {
    name,
    id: name,
    state,
    startedAt: start === undefined ? null : at(start),
    finishedAt: end === undefined ? null : at(end),
    blocker: null,
    url: "https://woodpecker.sjer.red/repos/1/pipeline/100",
  };
}

function run(workflows: CiWorkflow[], fields: Partial<CiRun> = {}): CiRun {
  return {
    pipeline: 100,
    attempt: 1,
    commit: "a1b2c3d4",
    event: "pull_request",
    pr: 7,
    branch: "main",
    state: "running",
    createdAt: at(-50),
    finishedAt: null,
    url: "https://woodpecker.sjer.red/repos/1/pipeline/100",
    requiredWorkflows: ["verify", "lint"],
    workflows,
    ...fields,
  };
}

function sample(active: CiRun[]): CiDashboardSample {
  return CiDashboardSampleSchema.parse({
    sampledAt: at(0),
    queue: {
      sampledAt: at(0),
      paused: false,
      ready: 2,
      running: 2,
      waitingOnDependencies: 1,
      oldestQueuedPipelineCreatedAt: at(-50),
    },
    admission: null,
    jobs: { sampledAt: at(0), active, recent: [], partial: false },
  });
}

function history(length = 10): CiTimingHistory {
  return {
    sampledAt: at(0),
    attempts: Array.from({ length }, (_, index) => ({
      pipeline: index + 1,
      attempt: 0,
      finishedAt: at(-600),
      event: "pull_request",
      requiredWorkflows: ["verify", "lint"],
      turnaroundSeconds: 120 + index,
      gateTailSeconds: 20,
      workflows: [
        { name: "verify", durationSeconds: 70 },
        { name: "lint", durationSeconds: 60 },
        { name: "ci-complete", durationSeconds: 15 },
      ],
    })),
  };
}

describe("CI dashboard estimates", () => {
  test("uses a historical range while prerequisites are queued, even with an advisory failure", () => {
    const pending = run([
      workflow("verify", "ready"),
      workflow("lint", "ready"),
      workflow("ci-complete", "waiting"),
      workflow("advisory", "failure", -24, -20),
    ]);
    expect(estimateCiDashboard(sample([pending]), history(), now)).toEqual({
      runs: {
        [ciRunKey(pending)]: {
          kind: "rough",
          earliestAt: at(71),
          latestAt: at(77),
        },
      },
      workflows: {},
    });
  });

  test("refines from the latest parallel prerequisite, then follows the running gate", () => {
    const verify = workflow("verify", "running", -20);
    const lint = workflow("lint", "running", -8);
    const pending = run([verify, lint, workflow("ci-complete", "waiting")]);
    const refined = estimateCiDashboard(sample([pending]), history(), now);
    expect(refined.workflows[ciWorkflowKey(pending, verify)]).toEqual({
      kind: "running",
      earliestAt: at(50),
      latestAt: at(50),
    });
    expect(refined.runs[ciRunKey(pending)]).toEqual({
      kind: "refined",
      earliestAt: at(72),
      latestAt: at(72),
    });

    const active = run([
      workflow("verify", "success", -50, -8),
      workflow("lint", "success", -20, -7),
      workflow("ci-complete", "running", -4),
    ]);
    expect(
      estimateCiDashboard(sample([active]), history(), now).runs[
        ciRunKey(active)
      ],
    ).toEqual({
      kind: "running",
      earliestAt: at(11),
      latestAt: at(11),
    });
  });

  test("allows the same event and workflow count band when the exact cohort is sparse", () => {
    const pending = run(
      [
        workflow("verify", "ready"),
        workflow("unit", "ready"),
        workflow("ci-complete", "waiting"),
      ],
      { requiredWorkflows: ["verify", "unit"] },
    );
    const baseline = history();
    const otherEvent = {
      ...baseline,
      attempts: baseline.attempts.map((entry) => ({ ...entry, event: "push" })),
    };
    expect(
      estimateCiDashboard(sample([pending]), baseline, now).runs[
        ciRunKey(pending)
      ]?.kind,
    ).toBe("rough");
    expect(
      estimateCiDashboard(sample([pending]), otherEvent, now).runs,
    ).toEqual({});
  });

  test("suppresses estimates when queue evidence is old, jobs are paused, or history is sparse", () => {
    const active = run(
      [workflow("verify", "running", -50), workflow("ci-complete", "waiting")],
      { requiredWorkflows: null },
    );
    const current = sample([active]);
    expect(estimateCiDashboard(current, history(9), now)).toEqual({
      runs: {},
      workflows: {},
    });
    expect(estimateCiDashboard(current, history(), new Date(at(180)))).toEqual({
      runs: {},
      workflows: {},
    });
    if (current.queue === null) throw new Error("fixture queue is missing");
    expect(
      estimateCiDashboard(
        { ...current, queue: { ...current.queue, paused: true } },
        history(),
        now,
      ),
    ).toEqual({ runs: {}, workflows: {} });
    const overrun = {
      ...active,
      workflows: [workflow("verify", "running", -71)],
    };
    expect(estimateCiDashboard(sample([overrun]), history(), now)).toEqual({
      runs: {},
      workflows: {},
    });
  });

  test("does not predict success when a required workflow fails or after the gate has completed", () => {
    const failed = run([
      workflow("verify", "failure", -50, -8),
      workflow("lint", "success", -20, -7),
      workflow("ci-complete", "ready"),
    ]);
    const complete = run(
      [
        workflow("verify", "success", -50, -8),
        workflow("lint", "success", -20, -7),
        workflow("ci-complete", "success", -6, -1),
      ],
      { pipeline: 101 },
    );
    expect(
      estimateCiDashboard(sample([failed, complete]), history(), now).runs,
    ).toEqual({});
  });

  test("measures the gate tail from its prerequisites and keeps the retry identity", () => {
    const complete = run(
      [
        workflow("verify", "success", -50, -35),
        workflow("lint", "success", -48, -30),
        workflow("ci-complete", "success", -28, -20),
        workflow("advisory", "failure", -20, -5),
      ],
      { state: "failure", finishedAt: at(-5) },
    );
    expect(ciTimingAttempt(complete)).toMatchObject({
      pipeline: 100,
      attempt: 1,
      turnaroundSeconds: 30,
      gateTailSeconds: 10,
      workflows: [
        { name: "verify", durationSeconds: 15 },
        { name: "lint", durationSeconds: 18 },
        { name: "ci-complete", durationSeconds: 8 },
      ],
    });
    expect(ciRunKey(complete)).not.toBe(ciRunKey({ ...complete, attempt: 0 }));
    expect(ciRunKey(complete)).not.toBe(
      ciRunKey({ ...complete, commit: "other" }),
    );
  });
});
