import { afterEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import { argoApplication } from "#lib/delivery/model/step-testing.ts";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import { artifact } from "#lib/delivery/model/testing.ts";
import type * as Activity from "@temporalio/activity";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";

const calls = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  const updates: unknown[] = [];
  const stages: { key: string; status: string; receipt: unknown }[] = [];
  return {
    events,
    reads,
    updates,
    stages,
    prune: false,
    credentialPrune: false,
    credentialFailure: false,
    lapsed: false,
    refuse: false,
    failRestore: false,
  };
});
vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
    }),
  },
}));
// The forum chart's tag still resolves to its frozen digest; oci-chart.test.ts
// covers a moved tag.
vi.mock("./oci-chart.ts", async () => {
  const { frozenOciChart } =
    await import("#lib/delivery/model/step-testing.ts");
  return frozenOciChart;
});
vi.mock("#lib/delivery/argo-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArgoClient>()),
  getArgoApplication: () => {
    calls.events.push("read");
    return Promise.resolve(
      calls.reads.length > 1 ? calls.reads.shift() : calls.reads[0],
    );
  },
  createArgoApplication: () => {
    calls.events.push("write");
    return Promise.resolve();
  },
  updateArgoApplication: (_name: string, body: unknown) => {
    calls.events.push("update");
    if (calls.failRestore && calls.updates.length > 0)
      return Promise.reject(new Error("Argo API returned HTTP 409"));
    calls.updates.push(body);
    return Promise.resolve();
  },
  deleteArgoApplication: (_name: string, input: { cascade: boolean }) => {
    calls.events.push(`delete cascade=${String(input.cascade)}`);
    return Promise.resolve({ deleted: true });
  },
}));
vi.mock("#activities/delivery/argocd.ts", async (importOriginal) => {
  const original = await importOriginal<typeof Argocd>();
  return {
    ...original,
    argoRequest: () => Promise.resolve(null),
    runGuardedArgoCommand: (args: string[]) => {
      calls.events.push(args.join(" "));
      return calls.refuse && args[0] === "assert-apply-safe"
        ? Promise.reject(
            new original.GuardedArgoCommandError(
              "assert-apply-safe",
              1,
              "Refusing storm-forum sync because the read-only apply-safety preflight found:\n- batch/Job storm-forum/migrate changes immutable /spec/template",
            ),
          )
        : Promise.resolve();
    },
  };
});
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  recordStage: (
    _current: unknown,
    key: string,
    status: string,
    receipt: unknown,
  ) => {
    calls.stages.push({ key, status, receipt });
    // The server refuses any stage write once the lease has lapsed (D7).
    if (calls.lapsed)
      return Promise.reject(
        new Error(
          "The deployment's lease lapsed; it is no longer provably owned and ends in recovery (D7)",
        ),
      );
    calls.events.push(`${key} ${status}`);
    return Promise.resolve();
  },
  requireOwned: () => Promise.resolve(fixture().current),
}));
vi.mock("./forum-bundle.ts", () => ({
  forumBaselineFence: () => {
    calls.events.push("baseline-check");
    return Promise.resolve();
  },
  forumSyncPrune: () => Promise.resolve(calls.prune),
}));
vi.mock("#lib/delivery/credential-prune.ts", () => ({
  credentialSyncPrunes: () => {
    if (calls.credentialFailure)
      throw new Error("Credential retirement proof failed");
    return Promise.resolve(calls.credentialPrune);
  },
}));

const { applySafety, sync } = await import("./kubernetes.ts");

/** The forum release, its chart in a store the sync reads by version. */
function fixture(stages: { key: string; status: "running" }[] = []) {
  return forumDetail(
    stages,
    artifact({
      id: "chart/forum",
      component: "chart:storm-forum",
      kind: "chart",
      uri: "oci://registry.example/storm-forum",
      version: "1.0.1",
      character: "b",
    }),
  );
}

/** The written Application, before and after this deployment's owned sync. */
function application(synced: boolean) {
  const { current, recipe } = fixture();
  return argoApplication(current, recipe, synced);
}

afterEach(() => {
  calls.events = [];
  calls.reads = [];
  calls.prune = false;
  calls.credentialPrune = false;
  calls.credentialFailure = false;
  calls.lapsed = false;
  calls.updates = [];
  calls.stages = [];
  calls.refuse = false;
  calls.failRestore = false;
});

describe("Kubernetes steps of a forum release", () => {
  test("apply-safety re-observes the original baseline before writing the candidate source", async () => {
    const { current, recipe } = fixture();
    calls.reads = [null];
    await applySafety(current, recipe, "step-apply-safety");
    expect(calls.events.slice(0, 4)).toEqual([
      "baseline-check",
      "step-apply-safety running",
      "read",
      "write",
    ]);
  });

  test("a resumed apply-safety keeps its recorded intent and skips the baseline check", async () => {
    // The server refuses the check once the step's stage exists.
    const { current, recipe } = fixture([
      { key: "step-apply-safety", status: "running" },
    ]);
    calls.reads = [null];
    await applySafety(current, recipe, "step-apply-safety");
    expect(calls.events).not.toContain("baseline-check");
    expect(calls.events.slice(0, 3)).toEqual([
      "step-apply-safety running",
      "read",
      "write",
    ]);
  });

  test.each([
    [true, ["--prune"]],
    [false, []],
  ])(
    "the sync prunes the prior release Job only when the guard allows it (%s)",
    async (prune, flags) => {
      const { current, recipe } = fixture();
      calls.prune = prune;
      calls.reads = [application(false), application(true)];
      await sync(current, recipe, "step-sync");
      const command = calls.events.find((event) =>
        event.startsWith("sync-managed"),
      );
      expect(command).toBe(
        [
          "sync-managed storm-forum --revision 1.0.1 --request-id",
          deliveryOperationId(current.deployment.id),
          ...flags,
          "--timeout 1200",
        ].join(" "),
      );
      // The baseline was re-observed before the source changed, not here.
      expect(calls.events).not.toContain("baseline-check");
    },
  );

  test("a resumed sync re-records its intent before the Argo sync (D7)", async () => {
    const { current, recipe } = fixture([
      { key: "step-sync", status: "running" },
    ]);
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    const intent = calls.events.indexOf("step-sync running");
    const effect = calls.events.findIndex((event) =>
      event.startsWith("sync-managed"),
    );
    expect(intent).toBeGreaterThanOrEqual(0);
    expect(intent).toBeLessThan(effect);
  });

  test("the credential guard authorizes pruning through the owned sync", async () => {
    const { current, recipe } = fixture();
    calls.credentialPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain("--prune");
    expect(calls.events.indexOf("step-sync running")).toBeLessThan(
      calls.events.findIndex((event) => event.startsWith("sync-managed")),
    );
  });

  test("failed credential proof prevents the native sync", async () => {
    const { current, recipe } = fixture();
    calls.credentialFailure = true;
    calls.reads = [application(false)];
    await expect(sync(current, recipe, "step-sync")).rejects.toThrow(
      "Credential retirement proof failed",
    );
    expect(calls.events).toEqual(["read", "step-sync running"]);
  });

  test("a resumed sync whose lease lapsed is refused at its intent before any Argo sync (D7)", async () => {
    const { current, recipe } = fixture([
      { key: "step-sync", status: "running" },
    ]);
    calls.reads = [application(false)];
    calls.lapsed = true;
    await expect(sync(current, recipe, "step-sync")).rejects.toThrow(
      /lease lapsed/u,
    );
    expect(calls.events).toEqual(["read"]);
  });
});

/** An existing Application whose last sync was `synced`. */
const synced = { chart: "storm-forum", targetRevision: "1.0.0" };
function existingApplication() {
  return {
    metadata: { name: "storm-forum", resourceVersion: "7" },
    spec: { source: synced },
    status: {
      history: [
        { id: 4, source: { chart: "storm-forum", targetRevision: "0.9.0" } },
        { id: 5, source: synced },
      ],
    },
  };
}

async function refusal(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected apply-safety to fail");
}

/**
 * temporal/prod c0025f42 (2026-11-07): assert-apply-safe refused after the
 * candidate body was written, the stage stayed running, and the stale body
 * stalled the next release. A refusal now undoes the write and settles.
 */
describe("a refused apply-safety", () => {
  test("restores the source Argo last synced and settles a failed stage with the findings", async () => {
    const { current, recipe } = fixture();
    calls.reads = [existingApplication()];
    calls.refuse = true;
    const error = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      type: "DeliveryApplySafetyRefused",
      nonRetryable: true,
    });
    // The candidate body, then the restore of the latest history source.
    expect(calls.updates).toHaveLength(2);
    expect(calls.updates[1]).toMatchObject({
      metadata: { resourceVersion: "7" },
      spec: { source: synced },
    });
    expect(calls.stages.map(({ status }) => status)).toEqual([
      "running",
      "failed",
    ]);
    expect(calls.stages[1]?.receipt).toMatchObject({
      evidence: [
        {
          kind: "preflight",
          summary: expect.stringContaining("changes immutable /spec/template"),
        },
      ],
    });
  });

  test("removes an Application it created, without cascading", async () => {
    const { current, recipe } = fixture();
    calls.reads = [null];
    calls.refuse = true;
    const error = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).toMatchObject({ type: "DeliveryApplySafetyRefused" });
    expect(calls.events).toContain("write");
    // The write is undone before the stage settles.
    expect(calls.events.slice(-2)).toEqual([
      "delete cascade=false",
      "step-apply-safety failed",
    ]);
    expect(calls.stages.at(-1)?.status).toBe("failed");
  });

  test("keeps the stage running for recovery when the restore itself fails", async () => {
    const { current, recipe } = fixture();
    calls.reads = [existingApplication()];
    calls.refuse = true;
    calls.failRestore = true;
    const error = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(error).not.toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({ name: "GuardedArgoCommandError" });
    expect(calls.stages.map(({ status }) => status)).toEqual(["running"]);
  });
});
