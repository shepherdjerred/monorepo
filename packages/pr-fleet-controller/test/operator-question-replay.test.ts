import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadRunBundle,
  replayRunBundle,
} from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import type { FleetSnapshot } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

const snapshot: FleetSnapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
  waiting: 0,
  paused: 0,
  prs: [],
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRecorder() {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
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

describe("operator question replay", () => {
  const headSha = "c".repeat(40);
  const correlation = { prNumber: 42, headSha, generation: 3 };
  const request = {
    id: "operator-question-1",
    pr: 42,
    headSha,
    generation: 3,
    context: "The inherited commit can plausibly belong to either PR.",
    questions: [
      {
        id: "ownership",
        header: "Ownership",
        question: "Should the inherited commit ship here?",
        options: [
          {
            id: "include",
            label: "Include it",
            description: "Its paths and intent match this PR.",
            recommended: true,
          },
          {
            id: "exclude",
            label: "Exclude it",
            description: "It belongs to separate operator work.",
            recommended: false,
          },
        ],
      },
    ],
    createdAt: "2026-08-08T20:00:00.000Z",
  };
  const answer = {
    requestId: request.id,
    answers: [{ questionId: "ownership", optionId: "include", freeText: null }],
  };

  async function finalizedQuestionBundle(duplicateTerminal: boolean) {
    const recorder = await createRecorder();
    recorder.record("run.started", { phase: "startup" });
    recorder.record("operator.question.asked", { request }, correlation);
    recorder.record(
      "operator.question.answered",
      { requestId: request.id, answer },
      correlation,
    );
    if (duplicateTerminal) {
      recorder.record(
        "operator.question.superseded",
        { requestId: request.id, reason: "PR head changed" },
        correlation,
      );
    }
    recorder.record("shutdown.started", { activeWorkers: 0 });
    recorder.record("shutdown.completed", { snapshot });
    await recorder.finalize("completed", snapshot);
    return loadRunBundle(recorder.paths.runDirectory);
  }

  test("verifies PR/head correlation and a single answer lifecycle", async () => {
    const report = replayRunBundle(await finalizedQuestionBundle(false), {
      currentControllerVersion: "0.1.0",
      allowVersionMismatch: false,
    });
    expect(report.operatorQuestions).toEqual({
      asked: 1,
      answered: 1,
      superseded: 0,
      open: [],
    });
  });

  test("rejects duplicate answer/supersession terminal events", async () => {
    const bundle = await finalizedQuestionBundle(true);
    expect(() =>
      replayRunBundle(bundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow("multiple terminal events");
  });
});
