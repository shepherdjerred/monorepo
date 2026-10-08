import { expect, test } from "vitest";
import { occupiedSeconds, pipelineTiming } from "#lib/ci/timing.ts";
import { CiPodListSchema, summarizeCiPods } from "#lib/ci/pods.ts";
import { ciFixture } from "./fixtures.ts";

test("parallel and nested workflows are counted once", () => {
  expect(
    occupiedSeconds([
      { start: 10, end: 30 },
      { start: 15, end: 20 },
      { start: 25, end: 40 },
      { start: 50, end: 60 },
    ]),
  ).toBe(40);
});

test("waiting outside workflows and completion delay are visible", () => {
  const base = ciFixture().pipeline;
  if (base === null) throw new Error("missing fixture");
  const result = pipelineTiming(
    {
      ...base,
      created: 100,
      finished: 300,
      workflows: [
        {
          id: 11,
          name: "verify",
          state: "success",
          started: 120,
          finished: 200,
        },
        {
          id: 12,
          name: "browser",
          state: "success",
          started: 150,
          finished: 250,
        },
        {
          id: 13,
          name: "ci-complete",
          state: "success",
          started: 290,
          finished: 300,
        },
      ],
    },
    400,
  );
  expect(result.elapsedSeconds).toBe(200);
  expect(result.withoutActiveWorkflowSeconds).toBe(60);
  expect(result.completionDelayLowerBoundSeconds).toBe(40);
  expect(result.workflows[0]?.workflowId).toBe(11);
  expect(result.workflows[0]?.taskId).toBe("11");
});

test("workflow task IDs join directly to native pod labels", () => {
  const base = ciFixture().pipeline;
  if (base === null) throw new Error("missing fixture");
  const timing = pipelineTiming({
    ...base,
    workflows: [
      { id: 23_988, name: "verify", state: "running" },
      { name: "ci-complete", state: "pending" },
    ],
  });
  const [pod] = summarizeCiPods(
    CiPodListSchema.parse({
      items: [
        {
          metadata: {
            name: "wp-fixture",
            uid: "pod-fixture",
            creationTimestamp: "2026-10-08T00:00:00Z",
            labels: { "woodpecker-ci.org/task-uuid": "23988" },
          },
          spec: {},
        },
      ],
    }),
  );
  expect(
    timing.workflows.find((workflow) => workflow.taskId === pod?.taskId)?.name,
  ).toBe("verify");
  expect(timing.workflows[1]?.workflowId).toBeNull();
  expect(timing.workflows[1]?.taskId).toBeNull();
});

test("queued and running phases retain unknown timestamps", () => {
  const base = ciFixture().pipeline;
  if (base === null) throw new Error("missing fixture");
  const result = pipelineTiming(
    {
      ...base,
      created: 100,
      status: "running",
      finished: 0,
      workflows: [
        { name: "verify", state: "running", started: 120, finished: 0 },
        { name: "ci-complete", state: "pending", started: 0, finished: 0 },
      ],
    },
    200,
  );
  expect(result.elapsedSeconds).toBe(100);
  expect(result.withoutActiveWorkflowSeconds).toBe(20);
  expect(result.completionDelayLowerBoundSeconds).toBeNull();
  expect(result.workflows[1]?.elapsedSeconds).toBeNull();
  expect(pipelineTiming(base).elapsedSeconds).toBeNull();
});

test.each([0, undefined])(
  "running intervals tolerate clock skew (end=%s)",
  (finished) => {
    const base = ciFixture().pipeline;
    if (base === null) throw new Error("missing fixture");
    const result = pipelineTiming(
      {
        ...base,
        created: 120,
        status: "running",
        finished,
        workflows: [
          {
            name: "verify",
            state: "running",
            started: 121,
            finished,
            children: [
              {
                id: 1,
                pid: 1,
                name: "verify",
                state: "running",
                exit_code: 0,
                started: 122,
                finished,
              },
            ],
          },
        ],
      },
      119,
    );
    expect(result.elapsedSeconds).toBe(0);
    expect(result.withoutActiveWorkflowSeconds).toBe(0);
    expect(result.workflows[0]?.elapsedSeconds).toBe(0);
    expect(result.workflows[0]?.phases[0]?.elapsedSeconds).toBe(0);
  },
);

test("inconsistent completed timing is a contract error", () => {
  const base = ciFixture().pipeline;
  if (base === null) throw new Error("missing fixture");
  expect(() =>
    pipelineTiming({ ...base, created: 200, finished: 100 }),
  ).toThrow("before");
});

test.each([0, undefined])(
  "terminal intervals need a finish timestamp (end=%s)",
  (finished) => {
    const base = ciFixture().pipeline;
    if (base === null) throw new Error("missing fixture");
    const result = pipelineTiming(
      {
        ...base,
        created: 100,
        status: "success",
        finished,
        workflows: [
          {
            name: "verify",
            state: "failure",
            started: 110,
            finished,
            children: [
              {
                id: 1,
                pid: 1,
                name: "verify",
                state: "killed",
                exit_code: 1,
                started: 120,
                finished,
              },
            ],
          },
        ],
      },
      200,
    );
    expect(result.elapsedSeconds).toBeNull();
    expect(result.withoutActiveWorkflowSeconds).toBeNull();
    expect(result.workflows[0]?.elapsedSeconds).toBeNull();
    expect(result.workflows[0]?.phases[0]?.elapsedSeconds).toBeNull();
  },
);

test.each([
  { started: 0, finished: 200 },
  { started: 120, finished: 0 },
  { started: undefined, finished: undefined },
])("missing workflow timestamps cannot prove inactivity (%j)", (timestamps) => {
  const base = ciFixture().pipeline;
  if (base === null) throw new Error("missing fixture");
  const result = pipelineTiming(
    {
      ...base,
      created: 100,
      finished: 200,
      workflows: [{ name: "verify", state: "success", ...timestamps }],
    },
    300,
  );
  expect(result.elapsedSeconds).toBe(100);
  expect(result.workflows[0]?.elapsedSeconds).toBeNull();
  expect(result.withoutActiveWorkflowSeconds).toBeNull();
});

test("unstarted skipped work contributes no activity; missing workflows stay unknown", () => {
  const base = ciFixture().pipeline;
  if (base === null) throw new Error("missing fixture");
  const pipeline = { ...base, created: 100, finished: 200 };
  const result = pipelineTiming({
    ...pipeline,
    workflows: [
      { name: "verify", state: "success", started: 120, finished: 160 },
      { name: "optional", state: "skipped" },
    ],
  });
  expect(result.withoutActiveWorkflowSeconds).toBe(60);
  expect(
    pipelineTiming({ ...pipeline, workflows: [] }).withoutActiveWorkflowSeconds,
  ).toBeNull();
});

test("completion delay is only a lower bound when advisory work finishes later", () => {
  const base = ciFixture().pipeline;
  if (base === null) throw new Error("missing fixture");
  const result = pipelineTiming({
    ...base,
    created: 100,
    finished: 200,
    workflows: [
      { name: "verify", state: "success", started: 120, finished: 160 },
      { name: "ci-complete", state: "success", started: 180, finished: 190 },
      { name: "advisory", state: "success", started: 120, finished: 195 },
    ],
  });
  expect(result.completionDelayLowerBoundSeconds).toBe(0);
});
