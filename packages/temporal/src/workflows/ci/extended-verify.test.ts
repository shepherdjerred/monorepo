import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowFailedError } from "@temporalio/client";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type {
  CiExtendedVerifyResult,
  ExtendedVerifyReceipt,
  ExtendedVerifyRequest,
  ExtendedVerifySubmission,
} from "#shared/ci-extended-verify.ts";
import { CI_EXTENDED_VERIFY_SCHEDULE } from "#schedules/ci-extended-verify-schedule.ts";

const workflowPath = new URL("../index.ts", import.meta.url).pathname;
const source = "a".repeat(40);
const url = "https://woodpecker.sjer.red/repos/1/pipeline/77";
const receipt = (
  status: string,
  workflows: ExtendedVerifyReceipt["workflows"] = [
    { name: "verify-extended", state: status },
  ],
): ExtendedVerifyReceipt => ({
  number: 77,
  url,
  commit: "b".repeat(40),
  status,
  workflows,
});

type Scenario = {
  name: string;
  selected?: (string | null)[];
  submissions: (ExtendedVerifySubmission | Error)[];
  readBack?: ExtendedVerifyReceipt | null;
  polls: ExtendedVerifyReceipt[];
  /** The exact result, with asymmetric matchers, or a failure message fragment. */
  expected: { result: Record<string, unknown> } | { failure: string };
  submitted: number;
  described: number;
};

const scenarios: Scenario[] = [
  {
    name: "a green pipeline verifies the selected source after one deferral",
    submissions: [
      { kind: "deferred", reason: "canary active" },
      { kind: "submitted", receipt: receipt("created") },
    ],
    polls: [receipt("running"), receipt("success")],
    expected: {
      result: {
        outcome: "verified",
        pipeline: 77,
        url,
        commit: source,
        durationMs: expect.any(Number),
      },
    },
    submitted: 2,
    described: 2,
  },
  {
    name: "a superseded source ends skipped, not failed",
    submissions: [{ kind: "submitted", receipt: receipt("running") }],
    polls: [
      receipt("success", [{ name: "extended-superseded", state: "success" }]),
    ],
    expected: {
      result: {
        outcome: "skipped",
        reason: "superseded",
        detail: expect.stringContaining(url),
      },
    },
    submitted: 1,
    described: 1,
  },
  {
    name: "a red pipeline fails the Workflow with the pipeline URL",
    submissions: [{ kind: "submitted", receipt: receipt("running") }],
    polls: [receipt("failure")],
    expected: { failure: `verify-extended=failure): ${url}` },
    submitted: 1,
    described: 1,
  },
  {
    name: "the dispatch flag off ends skipped without polling",
    submissions: [{ kind: "skipped", reason: "disabled" }],
    polls: [],
    expected: {
      result: {
        outcome: "skipped",
        reason: "disabled",
        detail: "ci-extended-verify-dispatch-enabled is off",
      },
    },
    submitted: 1,
    described: 0,
  },
  {
    name: "no verified main build ends skipped before any write",
    selected: [null],
    submissions: [],
    polls: [],
    expected: {
      result: {
        outcome: "skipped",
        reason: "no-verified-source",
        detail: "no complete main build to verify",
      },
    },
    submitted: 0,
    described: 0,
  },
  {
    name: "an ambiguous write is read back by request ID, never repeated",
    submissions: [new Error("Response lost after POST")],
    readBack: receipt("running"),
    polls: [receipt("success")],
    expected: {
      result: {
        outcome: "verified",
        pipeline: 77,
        url,
        commit: source,
        durationMs: expect.any(Number),
      },
    },
    submitted: 1,
    described: 1,
  },
  {
    name: "an ambiguous write with no receipt fails for operator review",
    submissions: [new Error("Response lost after POST")],
    readBack: null,
    polls: [],
    expected: { failure: "left no pipeline receipt: Response lost after POST" },
    submitted: 1,
    described: 0,
  },
];

describe("CI extended verify Workflow", () => {
  test("nightly declaration is paused, SKIP and credentialless on the Workflow queue", () => {
    expect(CI_EXTENDED_VERIFY_SCHEDULE).toMatchObject({
      namespace: "prod",
      id: "ci-extended-verify-nightly",
      workflowType: "runCiExtendedVerifyWorkflow",
      taskQueue: TASK_QUEUES.WORKFLOWS,
      overlap: "SKIP",
      timing: { expression: "0 2 * * *", timezone: "America/Los_Angeles" },
      workflowExecutionTimeout: "4 hours",
      initialPauseNote:
        "Awaiting 100% candidate traffic for runCiExtendedVerifyWorkflow; stable workers do not register this Workflow",
    });
    expect(CI_EXTENDED_VERIFY_SCHEDULE.requiredEnvironment).toBeUndefined();
    expect(CI_EXTENDED_VERIFY_SCHEDULE.catchupWindow).toBeUndefined();
  });

  test.each(scenarios)(
    "$name",
    async (scenario) => {
      const environment = await TestWorkflowEnvironment.createTimeSkipping();
      const requests: ExtendedVerifyRequest[] = [];
      const polls = [...scenario.polls];
      const selected = [...(scenario.selected ?? [])];
      const submissions = [...scenario.submissions];
      let described = 0;
      const workflowId = `extended-verify-${crypto.randomUUID()}`;
      try {
        const run = runWorkflowWithActivityWorker(environment, {
          workflowPath,
          activityTaskQueue: TASK_QUEUES.REPO_AUTOMATION,
          activities: {
            selectExtendedVerifySource: () =>
              Promise.resolve(
                selected.length === 0 ? source : selected.shift(),
              ),
            submitExtendedVerify: (request: ExtendedVerifyRequest) => {
              requests.push(request);
              const next = submissions.shift();
              if (next === undefined)
                throw new Error("Unexpected extra submission");
              if (next instanceof Error) throw next;
              return Promise.resolve(next);
            },
            findExtendedVerifyReceipt: () =>
              Promise.resolve(scenario.readBack ?? null),
            describeExtendedVerify: () => {
              described++;
              const next = polls.shift();
              if (next === undefined) throw new Error("Unexpected extra poll");
              return Promise.resolve(next);
            },
          },
          execute: () =>
            environment.client.workflow.execute<
              () => Promise<CiExtendedVerifyResult>
            >("runCiExtendedVerifyWorkflow", {
              workflowId,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              workflowExecutionTimeout: "4 hours",
            }),
        });
        if ("failure" in scenario.expected) {
          const failure = await run.catch((error: unknown) => error);
          expect(failure).toBeInstanceOf(WorkflowFailedError);
          if (!(failure instanceof WorkflowFailedError)) throw failure;
          expect(failure.cause?.message).toContain(scenario.expected.failure);
          expect(failure.cause).toMatchObject({ nonRetryable: true });
        } else {
          expect(await run).toEqual(scenario.expected.result);
        }
        expect(requests).toHaveLength(scenario.submitted);
        expect(new Set(requests.map((request) => request.requestId)).size).toBe(
          Math.min(1, scenario.submitted),
        );
        for (const request of requests) expect(request.source).toBe(source);
        expect(described).toBe(scenario.described);
        const handle = environment.client.workflow.getHandle(workflowId);
        const description = await handle.describe();
        expect(description.memo?.["ciExtendedVerify"]).toMatchObject({
          requestId: requests[0]?.requestId ?? expect.any(String),
          observation: expect.any(String),
        });
        await Worker.runReplayHistory(
          { workflowsPath: workflowPath },
          await handle.fetchHistory(),
        );
      } finally {
        await environment.teardown();
      }
    },
    60_000,
  );
});
