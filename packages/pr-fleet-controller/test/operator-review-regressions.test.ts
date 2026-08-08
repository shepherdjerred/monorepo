import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  CommandRequest,
  CommandResult,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import {
  loadRunBundle,
  replayRunBundle,
} from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import {
  FleetSnapshotSchema,
  OperatorInputAnswerSchema,
  OperatorInputRequestSchema,
  PrStateSchema,
  type FleetSnapshot,
  type PrIdentity,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { WorktreeManager } from "@shepherdjerred/pr-fleet-controller/src/worktree.ts";
import { evidence, identity } from "./fixtures.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function question(id: string) {
  return {
    id,
    header: "Ownership",
    question: "Should this inherited work ship with the PR?",
    options: [
      {
        id: "include",
        label: "Include it",
        description: "The paths and intent match this PR.",
        recommended: true,
      },
      {
        id: "exclude",
        label: "Exclude it",
        description: "The work belongs to another change.",
        recommended: false,
      },
    ],
  };
}

function request(questions: ReturnType<typeof question>[]) {
  return {
    id: "operator-question-1",
    pr: 42,
    headSha: "c".repeat(40),
    generation: 3,
    context: "Inherited work has ambiguous ownership.",
    questions,
    createdAt: "2026-08-08T20:00:00.000Z",
  };
}

describe("operator question schema regressions", () => {
  test("rejects duplicate request question IDs", () => {
    expect(
      OperatorInputRequestSchema.safeParse(
        request([question("ownership"), question("ownership")]),
      ).success,
    ).toBe(false);
  });

  test("rejects duplicate answer question IDs", () => {
    expect(
      OperatorInputAnswerSchema.safeParse({
        requestId: "operator-question-1",
        answers: [
          { questionId: "ownership", optionId: "include", freeText: null },
          { questionId: "ownership", optionId: "exclude", freeText: null },
        ],
      }).success,
    ).toBe(false);
  });

  test("reads schema-v1 snapshots that predate the waiting aggregate", () => {
    const parsed = FleetSnapshotSchema.parse({
      open: 0,
      green: 0,
      active: 0,
      queued: 0,
      pending: 0,
      paused: 0,
      prs: [],
    });
    expect(parsed.waiting).toBe(0);
  });
});

async function createRecorder(): Promise<RunRecorder> {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-review-"));
  temporaryDirectories.push(stateDirectory);
  return RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/worktrees",
    maxWorkers: 2,
  });
}

const replayOptions = {
  currentControllerVersion: "0.1.0",
  allowVersionMismatch: false,
};

test("replay rejects duplicate responses for one operator question", async () => {
  const recorder = await createRecorder();
  const operatorRequest = request([question("ownership"), question("history")]);
  const correlation = {
    prNumber: operatorRequest.pr,
    headSha: operatorRequest.headSha,
    generation: operatorRequest.generation,
  };
  recorder.record("run.started", { phase: "startup" });
  recorder.record(
    "operator.question.asked",
    { request: operatorRequest },
    correlation,
  );
  recorder.record(
    "operator.question.answered",
    {
      requestId: operatorRequest.id,
      answer: {
        requestId: operatorRequest.id,
        answers: [
          { questionId: "ownership", optionId: "include", freeText: null },
          { questionId: "ownership", optionId: "exclude", freeText: null },
        ],
      },
    },
    correlation,
  );
  await recorder.finalize("failed", null, new Error("invalid answer"));
  const bundle = await loadRunBundle(recorder.paths.runDirectory);

  expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
    /unique|exactly once/,
  );
});

test("replay verifies the waiting aggregate against PR states", async () => {
  const recorder = await createRecorder();
  const pr = identity(42);
  const state = PrStateSchema.parse({
    identity: pr,
    logicalOwner: "pr-42",
    runtimeAgent: null,
    agentGeneration: 1,
    model: "openai/gpt-5.6-terra",
    status: "waiting-for-answer",
    classification: "waiting-for-answer",
    stackId: "pr-42",
    worktree: "/tmp/worktrees/pr-42",
    setupComplete: true,
    evidence: evidence(pr),
    lastAgentReportAt: null,
    lastProgressAt: "2026-08-08T20:00:00.000Z",
    noProgressTicks: 0,
    prodSentAt: null,
    escalation: null,
    priority: 0,
  });
  const inconsistentSnapshot: FleetSnapshot = {
    open: 1,
    green: 0,
    active: 0,
    queued: 0,
    pending: 0,
    waiting: 0,
    paused: 0,
    prs: [state],
  };
  recorder.record("run.started", { phase: "startup" });
  recorder.record("shutdown.started", { activeWorkers: 0 });
  recorder.record("shutdown.completed", { snapshot: inconsistentSnapshot });
  await recorder.finalize("completed", inconsistentSnapshot);
  const bundle = await loadRunBundle(recorder.paths.runDirectory);

  expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
    "Fleet snapshot aggregate counts diverge from its PR states",
  );
});

function scriptedBehindWorktree(worktree: string, pr: PrIdentity) {
  let localHead = "d".repeat(40);
  const resets: string[] = [];
  const mustRun = (executable: string, args: string[]): Promise<string> => {
    if (executable === "git" && args[0] === "rev-parse") {
      if (args[1] === "--abbrev-ref") {
        return Promise.resolve(`${pr.headRefName}\n`);
      }
      if (args[1] === `refs/remotes/pull/${String(pr.number)}/head`) {
        return Promise.resolve(`${pr.headSha}\n`);
      }
      if (args[1] === "HEAD") {
        return Promise.resolve(`${localHead}\n`);
      }
    }
    if (executable === "git" && args[0] === "reset") {
      localHead = args[2] ?? localHead;
      resets.push(localHead);
    }
    return Promise.resolve("");
  };
  const run = (command: CommandRequest): Promise<CommandResult> => {
    const localIsAncestor =
      command.executable === "git" &&
      command.args[0] === "merge-base" &&
      command.args[2] === localHead &&
      command.args[3] === pr.headSha;
    return Promise.resolve({
      exitCode: localIsAncestor ? 0 : 1,
      stdout: "",
      stderr: "",
      termination: "exit",
    });
  };
  return {
    manager: new WorktreeManager({
      checkout: "/tmp/checkout",
      worktreeRoot: "/tmp/pr-fleet",
      run,
      mustRun,
    }),
    resets,
    worktree,
  };
}

describe("clean behind worktree adoption", () => {
  test("aligns a disposable fleet worktree to the fetched PR head", async () => {
    const pr = identity(43);
    const script = scriptedBehindWorktree("/tmp/pr-fleet/stack-43", pr);
    const context = await script.manager.assignWorktreeBranch(
      script.worktree,
      pr,
    );
    expect(script.resets).toEqual([pr.headSha]);
    expect(context).toMatchObject({ ownership: "fleet", relation: "exact" });
  });

  test("preserves an operator worktree that is behind the PR head", async () => {
    const pr = identity(44);
    const script = scriptedBehindWorktree("/home/user/monorepo", pr);
    const context = await script.manager.assignWorktreeBranch(
      script.worktree,
      pr,
    );
    expect(script.resets).toEqual([]);
    expect(context).toMatchObject({
      ownership: "operator",
      relation: "behind",
      dirty: false,
    });
  });
});
