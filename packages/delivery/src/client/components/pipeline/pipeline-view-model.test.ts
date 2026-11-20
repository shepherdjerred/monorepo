import { describe, expect, it } from "vitest";
import type {
  PipelineAction,
  PipelineStage,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import type {
  CiRunIntegration,
  CiWorkflow,
} from "#shared/hub/integration-contract.ts";
import {
  INLINE_ACTION_LIMIT,
  actionSummary,
  pipelineStages,
  stageActionList,
} from "./pipeline-view-model.ts";

function action(key: string, status: PipelineStatus = "succeeded") {
  return {
    key,
    title: key,
    status,
    detail: null,
    startedAt: null,
    finishedAt: null,
    target: null,
    links: [],
  } satisfies PipelineAction;
}

function stage(
  kind: PipelineStage["kind"],
  actions: PipelineAction[],
): PipelineStage {
  return {
    key: kind,
    kind,
    title: kind,
    status: "succeeded",
    execution: null,
    environmentId: null,
    transition: null,
    actions,
  };
}

function step(pid: number, name: string, status: PipelineStatus, exit = 0) {
  return {
    pid,
    name,
    status,
    exitCode: exit,
    startedAt: null,
    finishedAt: null,
    url: `https://woodpecker.sjer.red/repos/1/pipeline/7/${String(pid)}`,
  };
}

function workflow(
  pid: number,
  name: string,
  status: PipelineStatus,
  steps: CiWorkflow["steps"] = [step(pid * 10, `${name}-step`, status)],
): CiWorkflow {
  return {
    pid,
    name,
    stage: name.startsWith("test") ? "test" : "build",
    status,
    startedAt: null,
    finishedAt: null,
    steps,
  };
}

function run(workflows: CiWorkflow[]): CiRunIntegration {
  return {
    state: "available",
    fetchedAt: "2026-11-20T00:00:00.000Z",
    links: [],
    data: {
      number: 7,
      status: "succeeded",
      event: "push",
      branch: "main",
      author: "a",
      message: "m",
      createdAt: "2026-11-20T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      url: "https://woodpecker.sjer.red/repos/1/pipeline/7",
      workflows,
    },
  };
}

const many = (count: number, status: PipelineStatus = "succeeded") =>
  Array.from({ length: count }, (_, index) =>
    workflow(index + 1, `lane-${String(index + 1)}`, status),
  );

describe("a workflow's second line", () => {
  it("counts the steps of a workflow that passed, even when Woodpecker stopped its service with a failure", () => {
    const [, tests] = pipelineStages(
      [stage("build", [])],
      run([
        workflow(1, "test-e2e", "succeeded", [
          step(10, "tempo", "failed", 137),
          step(11, "run", "succeeded"),
        ]),
      ]),
    );
    const passed = tests?.actions[0];
    expect(passed?.status).toBe("succeeded");
    expect(passed?.detail).toBe("2 steps");
    // The link opens a step that passed, not the stopped service.
    expect(passed?.links[0]?.url).toMatch(/\/pipeline\/7\/11$/u);
    expect(JSON.stringify(passed)).not.toContain("exited");
  });

  it("names the failed step of a workflow that failed, and links to it", () => {
    const [, tests] = pipelineStages(
      [stage("build", [])],
      run([
        workflow(1, "test-unit", "failed", [
          step(10, "install", "succeeded"),
          step(11, "run", "failed", 2),
        ]),
      ]),
    );
    expect(tests?.actions[0]?.detail).toBe("Step run exited 2");
    expect(tests?.actions[0]?.links[0]?.url).toMatch(/\/pipeline\/7\/11$/u);
  });

  it("counts the steps of a workflow that has not failed, whatever a step reports", () => {
    for (const status of ["running", "canceled", "pending"] as const) {
      const [, tests] = pipelineStages(
        [stage("build", [])],
        run([
          workflow(1, "test-unit", status, [step(10, "run", "failed", 137)]),
        ]),
      );
      expect(tests?.actions[0]?.detail).toBe("1 step");
    }
  });
});

describe("the Build stage", () => {
  it("leads with the run Delivery qualified, then its workflows", () => {
    const [build] = pipelineStages(
      [stage("build", [action("qualification")])],
      run(many(2)),
    );
    expect(build?.actions.map((entry) => entry.key)).toEqual([
      "qualification",
      "workflow:1",
      "workflow:2",
    ]);
  });
});

describe("the summary of a list of actions", () => {
  it("names what it counts when every action shares one state", () => {
    expect(actionSummary([action("a"), action("b")])).toBe(
      "2 actions succeeded",
    );
    expect(actionSummary([action("a", "failed")])).toBe("1 action failed");
    expect(actionSummary([action("a", "awaiting_approval")])).toBe(
      "1 action awaiting approval",
    );
  });

  it("counts each outcome, finished first, when they differ", () => {
    expect(
      actionSummary([
        action("a", "running"),
        action("b", "not_started"),
        action("c"),
        action("d", "failed"),
        action("e"),
        action("f", "pending"),
      ]),
    ).toBe("2 succeeded · 1 failed · 1 running · 1 pending · 1 not started");
  });
});

describe("how a stage lists its actions", () => {
  it("shows a short list whole, in the stage's own order", () => {
    const actions = [
      action("deployment"),
      action("stage:render", "running"),
      action("stage:sync", "failed"),
    ];
    expect(stageActionList(stage("environment", actions))).toEqual({
      inline: actions,
      collapsed: null,
    });
    const atLimit = Array.from({ length: INLINE_ACTION_LIMIT }, (_, index) =>
      action(`artifact-${String(index)}`),
    );
    expect(stageActionList(stage("version", atLimit)).collapsed).toBeNull();
  });

  it("collapses a long list of passed workflows behind its count, closed", () => {
    const [build] = pipelineStages(
      [stage("build", [action("qualification")])],
      run(many(14)),
    );
    if (build === undefined) throw new Error("Build stage required");
    const list = stageActionList(build);
    // The qualified run stays in view; only its workflows collapse.
    expect(list.inline.map((entry) => entry.key)).toEqual(["qualification"]);
    expect(list.collapsed?.summary).toBe("14 workflows passed");
    expect(list.collapsed?.label).toBe("workflows");
    expect(list.collapsed?.open).toBe(false);
    expect(list.collapsed?.actions).toHaveLength(14);
  });

  it("opens the list and leads with what failed, is running or awaits approval", () => {
    const workflows = many(14);
    for (const [index, status] of [
      [3, "running"],
      [7, "awaiting_approval"],
      [9, "failed"],
      [11, "running"],
    ] as const) {
      const lane = workflows[index];
      if (lane === undefined) throw new Error("Workflow fixture required");
      lane.status = status;
    }
    const [build] = pipelineStages([stage("build", [])], run(workflows));
    if (build === undefined) throw new Error("Build stage required");
    const list = stageActionList(build).collapsed;
    expect(list?.open).toBe(true);
    expect(list?.summary).toBe(
      "10 passed · 1 failed · 2 running · 1 awaiting approval",
    );
    expect(list?.actions.map((entry) => entry.title)).toEqual([
      "lane-10",
      "lane-4",
      "lane-12",
      "lane-8",
      "lane-1",
      "lane-2",
      "lane-3",
      "lane-5",
      "lane-6",
      "lane-7",
      "lane-9",
      "lane-11",
      "lane-13",
      "lane-14",
    ]);
  });

  it("stays closed for states that need nobody: queued, pending, canceled, not started", () => {
    const workflows = many(8);
    for (const [index, status] of [
      [0, "queued"],
      [1, "pending"],
      [2, "canceled"],
      [3, "not_started"],
    ] as const) {
      const lane = workflows[index];
      if (lane === undefined) throw new Error("Workflow fixture required");
      lane.status = status;
    }
    const [build] = pipelineStages([stage("build", [])], run(workflows));
    if (build === undefined) throw new Error("Build stage required");
    const list = stageActionList(build).collapsed;
    expect(list?.open).toBe(false);
    // Nothing leads, so the list keeps the run's order.
    expect(list?.actions.map((entry) => entry.title)).toEqual(
      workflows.map((lane) => lane.name),
    );
  });

  it("counts a long version set as artifacts and any other long list as actions", () => {
    const artifacts = Array.from({ length: 6 }, (_, index) =>
      action(`image:${String(index)}`),
    );
    const version = stageActionList(stage("version", artifacts));
    expect(version.inline).toEqual([]);
    expect(version.collapsed?.summary).toBe("6 artifacts selected");
    expect(version.collapsed?.label).toBe("artifacts");
    const steps = [
      action("deployment"),
      ...Array.from({ length: 6 }, (_, index) =>
        action(`stage:${String(index)}`),
      ),
    ];
    const environment = stageActionList(stage("environment", steps));
    expect(environment.inline).toEqual([]);
    expect(environment.collapsed?.summary).toBe("7 actions succeeded");
    expect(environment.collapsed?.label).toBe("actions");
  });
});
