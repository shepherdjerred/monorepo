import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ExecutionSummary,
  HubService,
  PipelineStage,
} from "#shared/hub/hub-contract.ts";
import type { CiRunIntegration } from "#shared/hub/integration-contract.ts";
import { QueryClient } from "@tanstack/react-query";
import { changeDomain } from "#shared/hub/change-contract.ts";
import { keysForChange } from "./change-keys.ts";
import {
  pipelineStages,
  stageSummary,
} from "./components/pipeline/pipeline-view-model.ts";
import { traceStages } from "./components/pipeline/trace-view-model.ts";
import { Status } from "./components/status.tsx";
import {
  ConfirmButton,
  ConfirmDialogProvider,
  ConfirmQuestion,
} from "./components/confirm-dialog.tsx";
import { duration, relativeTime } from "./components/time.tsx";
import {
  ActivitySearchSchema,
  DeploymentSearchSchema,
} from "./routes/search-schemas.ts";
import {
  filterPipelines,
  lastDeployment,
  stageStatuses,
} from "./routes/pipeline-list-model.ts";

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

/** An environment of a pipeline whose newest deployment moved at `lastDeploymentAt`. */
function env(
  id: string,
  lastDeploymentAt: string | null,
): HubService["environments"][number] {
  return {
    id,
    name: id,
    status: "succeeded",
    recoveryRequired: false,
    acceptedRevision: 3,
    observedAt: null,
    approvalRequired: false,
    activeDeploymentId: null,
    lastDeploymentAt,
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

  it("dates the last deployment by any environment's newest, whatever build it carries", () => {
    // The newest build is a month old; prod deployed an older one today.
    const gitops: HubService = {
      ...pipeline("gitops", execution),
      environments: [
        env("gitops/beta", "2026-10-18T10:05:00.000Z"),
        env("gitops/prod", "2026-11-20T09:00:00.000Z"),
        env("gitops/next", null),
      ],
    };
    expect(lastDeployment(gitops)).toBe("2026-11-20T09:00:00.000Z");
    expect(lastDeployment(pipeline("forum", null))).toBeNull();
  });

  it("filters by name and by any stage's current status, CI run or environment", () => {
    const arcade: HubService = {
      ...pipeline("arcade", execution),
      latestBuild: {
        id: "b1",
        serviceId: "arcade",
        sourceRevision: "a".repeat(40),
        sourceKind: "ci",
        ciUrl: null,
        status: "verified",
        qualificationReason: null,
        platformChanges: null,
        createdAt: "2026-10-18T10:00:00.000Z",
        pipelineNumber: 18_050,
        links: [],
      },
      environments: [
        {
          id: "arcade/prod",
          name: "prod",
          status: "failed",
          recoveryRequired: true,
          acceptedRevision: 3,
          observedAt: null,
          approvalRequired: false,
          activeDeploymentId: null,
        },
      ],
    };
    const pipelines = [arcade, pipeline("forum", null)];
    const ids = (search: Parameters<typeof filterPipelines>[1]) =>
      filterPipelines(pipelines, search).map((entry) => entry.id);
    expect(ids({})).toEqual(["arcade", "forum"]);
    expect(ids({ q: "ARC" })).toEqual(["arcade"]);
    // A passed CI run does not hide a failed environment, nor the reverse.
    expect(ids({ status: "succeeded" })).toEqual(["arcade"]);
    expect(ids({ status: "failed" })).toEqual(["arcade"]);
    expect(ids({ status: "running" })).toEqual([]);
    expect(ids({ status: "not_started" })).toEqual(["forum"]);
    expect(stageStatuses(arcade)).toEqual(["succeeded", "failed"]);
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
    // The prefix covers `["deployment", "d1"]` and the detail of every other
    // deployment, whose `newerRequest` the change may have settled.
    expect(keys).toContainEqual(["deployment"]);
    expect(keys).toContainEqual(["integration", "runtime"]);
  });

  it("refreshes a failed deployment's detail when a newer request for its environment settles", async () => {
    const queryClient = new QueryClient();
    const failedKey = ["deployment", "failed-r13"];
    const newerKey = ["deployment", "queued-r14"];
    queryClient.setQueryData(failedKey, { newerRequest: { status: "queued" } });
    queryClient.setQueryData(newerKey, { deployment: { status: "queued" } });
    // The change names the newer request, never the older deployment.
    const change = {
      id: "a",
      domain: "deployment" as const,
      action: "deployment.canceled",
      entityId: "queued-r14",
    };
    for (const queryKey of keysForChange(change))
      await queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    expect(queryClient.getQueryState(failedKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(newerKey)?.isInvalidated).toBe(true);
    // A change to a build leaves deployment details alone.
    const other = new QueryClient();
    other.setQueryData(failedKey, {});
    for (const queryKey of keysForChange({
      id: "b",
      domain: "build",
      action: "build.verified",
      entityId: "b1",
    }))
      await other.invalidateQueries({ queryKey, refetchType: "none" });
    expect(other.getQueryState(failedKey)?.isInvalidated).toBe(false);
  });

  it("refreshes every commit page and commit for a build, release or environment change", () => {
    // `["commits"]` prefixes both `["commits", { cursor }]` and `["commits", sha]`.
    for (const action of [
      "build.verified",
      // A commit's title and author were first recorded, its build still pending.
      "build.source_recorded",
      "deployment.stage",
      "environment.registered",
      "versionSet.composed",
    ])
      expect(
        keysForChange({
          id: "a",
          domain: changeDomain(action),
          action,
          entityId: "e",
        }),
      ).toContainEqual(["commits"]);
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

  it("refreshes approvals when a saved platform plan is decided", () => {
    for (const action of [
      "platform.plan_approved",
      "platform.plan_rejected",
    ] as const)
      expect(
        keysForChange({
          id: "p1",
          domain: changeDomain(action),
          action,
          entityId: "d1",
        }),
      ).toContainEqual(["approvals"]);
  });
});

describe("search params", () => {
  it("drops empty values but keeps a typed status so the page can name the accepted ones", () => {
    expect(
      DeploymentSearchSchema.parse({ status: "exploded", service: " " }),
    ).toEqual({ status: "exploded", service: undefined });
    expect(DeploymentSearchSchema.parse({ status: 7 })).toEqual({
      status: undefined,
    });
    expect(ActivitySearchSchema.parse({ action: "deployment." })).toEqual({
      action: "deployment.",
    });
  });
});

/** A confirm button; "Retire" is the dangerous, disabled one and "Rebind" is waiting. */
function confirmButton(label: string, describedBy?: string) {
  return (
    <ConfirmButton
      label={label}
      title={`${label} this?`}
      confirmLabel={`${label} it`}
      danger={label === "Retire"}
      disabled={label === "Retire"}
      pending={label === "Rebind"}
      {...(describedBy === undefined ? {} : { describedBy })}
      onConfirm={() => {
        // Static render only.
      }}
    >
      <p>Body</p>
    </ConfirmButton>
  );
}

/** The dialog's question as static markup. */
function question(danger: boolean) {
  return renderToStaticMarkup(
    <ConfirmQuestion
      heading="question"
      title="Cancel this?"
      confirmLabel="Cancel it"
      danger={danger}
    >
      <p>Body</p>
    </ConfirmQuestion>,
  );
}

describe("presentation", () => {
  it("shows status as glyph and words", () => {
    const html = renderToStaticMarkup(<Status value="awaiting_approval" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("awaiting approval");
  });

  it("confirms through one native dialog however many buttons ask", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialogProvider>
        {confirmButton("Cancel", "row-1")}
        {confirmButton("Retire")}
        {confirmButton("Rebind")}
      </ConfirmDialogProvider>,
    );
    expect(html.match(/<dialog/gu)).toHaveLength(1);
    // The closed dialog holds only its form; the button that opens it
    // renders its question there.
    expect(html).toMatch(/<dialog><form method="dialog"><\/form><\/dialog>$/u);
    expect(html).not.toContain("Keep as is");
    expect(html).toContain(
      '<button type="button" class="secondary-button" aria-describedby="row-1">Cancel</button>',
    );
    expect(html).toContain(
      '<button type="button" class="secondary-button danger" disabled="">Retire</button>',
    );
    // A waiting button reads as disabled without being disabled, so it can
    // keep the focus the closing dialog returned to it.
    expect(html).toContain(
      '<button type="button" class="secondary-button" aria-disabled="true">Rebind</button>',
    );
  });

  it("a confirm button outside the dialog's provider fails loudly", () => {
    expect(() =>
      renderToStaticMarkup(
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
      ),
    ).toThrow("ConfirmDialogProvider");
  });

  it("the dialog's question defaults to keeping state", () => {
    const html = question(false);
    expect(html).toContain('<h2 id="question">Cancel this?</h2>');
    expect(html).toContain('<div class="dialog-body"><p>Body</p></div>');
    expect(html).toMatch(/autofocus[^>]*>Keep as is/iu);
    // "Keep as is" comes first, so it is also the first control in tab order.
    expect(html).toMatch(
      /<button value="cancel"[^>]*>Keep as is<\/button><button value="confirm" class="primary-button">Cancel it<\/button>/u,
    );
    expect(question(true)).toContain(
      '<button value="confirm" class="primary-button danger">Cancel it</button>',
    );
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
