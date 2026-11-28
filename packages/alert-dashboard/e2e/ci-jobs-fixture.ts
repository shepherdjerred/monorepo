import { Temporal } from "@js-temporal/polyfill";
import {
  ciRunKey,
  ciWorkflowKey,
  type CiDashboardResponse,
  type CiRun,
  type CiWorkflow,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";

export function ciJobsFixture(): CiDashboardResponse {
  const now = Temporal.Now.instant();
  const sampledAt = now.toString();
  const pipelineUrl = "https://woodpecker.sjer.red/repos/1/pipeline/1821";
  const verify: CiWorkflow = {
    id: "7294",
    name: "verify",
    state: "running",
    startedAt: now.subtract({ minutes: 5 }).toString(),
    finishedAt: null,
    url: `${pipelineUrl}/1`,
    blocker: null,
  };
  const run: CiRun = {
    pipeline: 1821,
    attempt: 1,
    commit: "e1a942fc0fa1c16f461ec6983912345678901234",
    pr: 42,
    branch: "ci/dashboard",
    event: "pull_request",
    state: "running",
    url: pipelineUrl,
    createdAt: now.subtract({ minutes: 8 }).toString(),
    finishedAt: null,
    requiredWorkflows: ["verify"],
    workflows: [
      verify,
      {
        ...verify,
        id: "7301",
        name: "ci-complete",
        state: "waiting_on_deps",
        startedAt: null,
        url: `${pipelineUrl}/2`,
        blocker: "Waiting for verify",
      },
    ],
  };
  const main: CiRun = {
    ...run,
    pipeline: 1820,
    attempt: 0,
    pr: null,
    branch: "main",
    event: "push",
    state: "success",
    url: "https://woodpecker.sjer.red/repos/1/pipeline/1820",
    createdAt: now.subtract({ minutes: 22 }).toString(),
    finishedAt: now.subtract({ minutes: 6 }).toString(),
    requiredWorkflows: null,
    workflows: [],
  };
  return {
    enabled: true,
    stale: false,
    unavailableSources: [],
    sample: {
      sampledAt,
      queue: {
        sampledAt,
        paused: false,
        ready: 4,
        waitingOnDependencies: 6,
        running: 3,
        oldestQueuedPipelineCreatedAt: now.subtract({ minutes: 8 }).toString(),
      },
      admission: { sampledAt, compute: 2, gates: 0 },
      jobs: { sampledAt, partial: false, active: [run], recent: [main] },
    },
    estimates: {
      runs: {
        [ciRunKey(run)]: {
          kind: "rough",
          earliestAt: now.add({ minutes: 4 }).toString(),
          latestAt: now.add({ minutes: 9 }).toString(),
        },
      },
      workflows: {
        [ciWorkflowKey(run, verify)]: {
          kind: "running",
          earliestAt: now.add({ minutes: 2 }).toString(),
          latestAt: now.add({ minutes: 5 }).toString(),
        },
      },
    },
  };
}
