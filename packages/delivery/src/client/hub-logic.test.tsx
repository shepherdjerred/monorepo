import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ExecutionSummary,
  HubService,
  PipelineStage,
} from "#shared/hub/hub-contract.ts";
import type { CiRunIntegration } from "#shared/hub/integration-contract.ts";
import { keysForChange } from "./change-keys.ts";
import {
  pipelineStages,
  stageSummary,
} from "./components/pipeline/pipeline-view-model.ts";
import { traceStages } from "./components/pipeline/trace-view-model.ts";
import { Status } from "./components/status.tsx";
import { ConfirmButton } from "./components/confirm-dialog.tsx";
import { duration, relativeTime } from "./components/time.tsx";
import {
  ActivitySearchSchema,
  DeploymentSearchSchema,
} from "./routes/search-schemas.ts";
import { filterPipelines, lastExecuted } from "./routes/pipeline-list-model.ts";

const build: PipelineStage = {
  key: "build",
  kind: "build",
  title: "Build",
  status: "succeeded",
  execution: null,
  environmentId: null,
  transition: { mode: "automatic", enabled: true, sourceEnvironmentId: null },
  actions: [
    {
      key: "qualification",
      title: "Woodpecker #1",
      status: "succeeded",
      detail: null,
      startedAt: null,
      finishedAt: null,
      target: null,
      links: [],
    },
  ],
};

function step(pid: number, status: "succeeded" | "failed") {
  return {
    pid,
    name: `step-${String(pid)}`,
    status,
    exitCode: status === "failed" ? 2 : 0,
    startedAt: null,
    finishedAt: null,
    url: `https://woodpecker.sjer.red/repos/1/pipeline/1/${String(pid)}`,
  };
}

function ci(testStatus: "succeeded" | "failed"): CiRunIntegration {
  return {
    state: "available",
    fetchedAt: "2026-10-18T00:00:00.000Z",
    links: [],
    data: {
      number: 1,
      status: testStatus,
      event: "push",
      branch: "main",
      author: "a",
      message: "m",
      createdAt: "2026-10-18T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      url: "https://woodpecker.sjer.red/repos/1/pipeline/1",
      workflows: [
        {
          pid: 1,
          name: "images",
          stage: "build",
          status: "succeeded",
          startedAt: null,
          finishedAt: null,
          steps: [step(10, "succeeded")],
        },
        {
          pid: 2,
          name: "verify",
          stage: "test",
          status: testStatus,
          startedAt: null,
          finishedAt: null,
          steps: [step(20, testStatus)],
        },
      ],
    },
  };
}

describe("pipeline view model", () => {
  it("keeps the server Build stage without CI enrichment", () => {
    expect(pipelineStages([build], undefined)).toEqual([build]);
  });

  it("splits Build and Test using classified CI workflows", () => {
    const stages = pipelineStages([build], ci("failed"));
    expect(stages.map((stage) => [stage.title, stage.status])).toEqual([
      ["Build", "succeeded"],
      ["Test", "failed"],
    ]);
    const test = stages[1];
    expect(test?.actions[0]?.detail).toBe("Step step-20 exited 2");
    expect(test?.actions[0]?.links[0]?.url).toContain("/pipeline/1/20");
    expect(stageSummary(stages[0] ?? build)).toBe("All actions succeeded");
  });
});

function pipeline(id: string, execution: ExecutionSummary | null): HubService {
  return {
    id,
    title: id.toUpperCase(),
    kind: "product",
    links: [],
    latestBuild: null,
    latestExecution: execution,
    environments: [],
  };
}

describe("pipeline list", () => {
  const execution: ExecutionSummary = {
    id: "build:b1",
    status: "running",
    build: null,
    versionSet: null,
    deployments: [
      {
        environmentId: "arcade/beta",
        deploymentId: "d1",
        kind: "deploy",
        status: "succeeded",
        createdAt: "2026-10-18T10:01:00.000Z",
        finishedAt: "2026-10-18T10:05:00.000Z",
      },
      {
        environmentId: "arcade/prod",
        deploymentId: "d2",
        kind: "promote",
        status: "running",
        createdAt: "2026-10-18T10:06:00.000Z",
        finishedAt: null,
      },
    ],
    createdAt: "2026-10-18T10:00:00.000Z",
  };

  it("dates the execution by its newest activity", () => {
    expect(lastExecuted(execution)).toBe("2026-10-18T10:06:00.000Z");
    expect(lastExecuted({ ...execution, deployments: [] })).toBe(
      "2026-10-18T10:00:00.000Z",
    );
  });

  it("filters by name and most recent execution status", () => {
    const pipelines = [pipeline("arcade", execution), pipeline("forum", null)];
    const ids = (search: Parameters<typeof filterPipelines>[1]) =>
      filterPipelines(pipelines, search).map((entry) => entry.id);
    expect(ids({})).toEqual(["arcade", "forum"]);
    expect(ids({ q: "ARC" })).toEqual(["arcade"]);
    expect(ids({ status: "running" })).toEqual(["arcade"]);
    expect(ids({ status: "not_started" })).toEqual(["forum"]);
  });
});

describe("change feed keys", () => {
  it("refreshes deployment views and always the hub", () => {
    const keys = keysForChange({
      id: "a",
      domain: "deployment",
      action: "deployment.stage",
      entityId: "d1",
    });
    expect(keys).toContainEqual(["hub"]);
    expect(keys).toContainEqual(["deployment", "d1"]);
    expect(keys).toContainEqual(["integration", "runtime"]);
  });

  it("leaves release views alone for imported snapshots", () => {
    expect(
      keysForChange({
        id: "a",
        domain: "snapshot",
        action: "snapshot.imported",
        entityId: "s",
      }),
    ).toEqual([["hub"], ["activity"]]);
  });
});

describe("search params", () => {
  it("drops invalid and empty values from hand-edited URLs", () => {
    expect(
      DeploymentSearchSchema.parse({ status: "exploded", service: " " }),
    ).toEqual({ status: undefined, service: undefined });
    expect(ActivitySearchSchema.parse({ action: "deployment." })).toEqual({
      action: "deployment.",
    });
  });
});

describe("presentation", () => {
  it("shows status as glyph and words", () => {
    const html = renderToStaticMarkup(<Status value="awaiting_approval" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("awaiting approval");
  });

  it("confirms through a native dialog that defaults to keeping state", () => {
    const html = renderToStaticMarkup(
      <ConfirmButton
        label="Cancel"
        title="Cancel this?"
        confirmLabel="Cancel it"
        onConfirm={() => {
          // Static render only.
        }}
      >
        <p>Body</p>
      </ConfirmButton>,
    );
    expect(html).toContain("<dialog");
    expect(html).toContain('method="dialog"');
    expect(html).toMatch(/autofocus[^>]*>Keep as is/iu);
  });

  it("formats relative times and durations", () => {
    const now = Date.parse("2026-10-18T12:00:00.000Z");
    expect(relativeTime("2026-10-18T11:58:00.000Z", now)).toBe("2 minutes ago");
    expect(
      duration("2026-10-18T11:00:00.000Z", "2026-10-18T12:05:00.000Z", now),
    ).toBe("1h 5m");
    expect(duration("2026-10-18T11:59:30.000Z", null, now)).toBe("30s");
  });
});

describe("trace source stage", () => {
  it.each([
    ["ci", "main", 1],
    ["attested", "Operator attestation", 0],
    ["upstream", "Upstream acquisition", 0],
  ] as const)(
    "labels a %s build as %s and links only CI commits",
    (sourceKind, label, links) => {
      const [source] = traceStages({
        service: {
          id: "storm-forum",
          title: "Storm forum",
          kind: "product",
          links: [],
        },
        status: "succeeded",
        build: {
          id: "build-1",
          serviceId: "storm-forum",
          sourceRevision: "a".repeat(40),
          sourceKind,
          ciUrl: null,
          status: "verified",
          qualificationReason: null,
          platformChanges: null,
          createdAt: "2026-10-21T00:00:00.000Z",
          pipelineNumber: null,
          links: [],
        },
        artifacts: [],
        versionSet: null,
        environments: [],
        deployments: [],
      });
      expect(source?.actions[0]?.detail).toBe(label);
      expect(source?.actions[0]?.links).toHaveLength(links);
    },
  );
});
