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
import {
  MEDIA_INGRESS_PRUNE_FLAG,
  MEDIA_INGRESS_PRUNE_INFO,
  mediaIngressSourceHash,
  type MediaIngressPruning,
} from "homelab/scripts/argocd/argocd-media-ingress-prunes.ts";

const calls = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  const updates: unknown[] = [];
  const stages: { key: string; status: string; receipt: unknown }[] = [];
  const argoResponses = new Map<string, unknown[]>();
  const hubReleases: unknown[] = [];
  const credentialDecision: { credentialPrune: boolean | MediaIngressPruning } =
    { credentialPrune: false };
  return {
    events,
    reads,
    updates,
    stages,
    argoResponses,
    prune: false,
    ...credentialDecision,
    credentialFailure: false,
    hubPrune: false,
    hubReleases,
    lapsed: false,
    refuse: false,
    failCreate: false,
    failUpdate: false,
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
    return calls.failCreate
      ? Promise.reject(new Error("Argo API returned HTTP 400"))
      : Promise.resolve();
  },
  updateArgoApplication: (_name: string, body: unknown) => {
    calls.events.push("update");
    if (calls.failUpdate)
      return Promise.reject(new Error("Argo API returned HTTP 400"));
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
    argoRequest: (path: string) => {
      const replies = calls.argoResponses.get(path);
      if (replies === undefined) return Promise.resolve(null);
      calls.events.push(path);
      return Promise.resolve(replies.shift());
    },
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

vi.mock("#lib/delivery/alert-dashboard/prune.ts", () => ({
  alertDashboardSyncPrunes: (release: unknown) => {
    calls.hubReleases.push(release);
    return Promise.resolve(calls.hubPrune);
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
  calls.hubPrune = false;
  calls.hubReleases = [];
  calls.argoResponses.clear();
  calls.lapsed = false;
  calls.updates = [];
  calls.stages = [];
  calls.refuse = false;
  calls.failCreate = false;
  calls.failUpdate = false;
  calls.failRestore = false;
});

function mediaRetirementFixture() {
  const initial = fixture();
  const current = {
    ...initial.current,
    deployment: {
      ...initial.current.deployment,
      environmentId: "streambot/prod",
    },
  };
  const recipe = {
    ...initial.recipe,
    application: {
      ...initial.recipe.application,
      name: "media",
      destination: {
        ...initial.recipe.application.destination,
        namespace: "media",
      },
      source: { ...initial.recipe.application.source, chart: "media" },
    },
    steps: initial.recipe.steps.filter(({ kind }) => kind !== "forum-bundle"),
  };
  const before = argoApplication(current, recipe, false);
  const after = argoApplication(current, recipe, true);
  const state = after.status.operationState;
  if (state === undefined) throw new Error("Synced fixture lost its operation");
  const ingress: MediaIngressPruning["resources"][number] = {
    group: "networking.k8s.io",
    kind: "Ingress",
    namespace: "media",
    name: "media-bazarr-tailscale-ingress-ingress",
    uid: "uid-bazarr",
  };
  const proof: MediaIngressPruning = {
    applicationUid: after.metadata.uid,
    sourceHash: mediaIngressSourceHash(after.spec.source),
    resources: [ingress],
  };
  state.operation.info.push({
    name: MEDIA_INGRESS_PRUNE_INFO,
    value: JSON.stringify(proof),
  });
  return {
    current,
    recipe,
    before,
    after,
    operation: state.operation,
    proof,
    ingress,
  };
}

describe("Media ingress retirement", () => {
  test("passes the reviewed candidates to guarded sync and verifies actual absence", async () => {
    const f = mediaRetirementFixture();
    calls.credentialPrune = f.proof;
    calls.reads = [f.before, f.after];
    calls.argoResponses.set("media?refresh=hard", [f.after]);
    calls.argoResponses.set("media/managed-resources", [{ items: [] }]);
    await sync(f.current, f.recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain(`${MEDIA_INGRESS_PRUNE_FLAG} ${JSON.stringify(f.proof)}`);
    expect(calls.events.slice(-3)).toEqual([
      "media?refresh=hard",
      "media/managed-resources",
      "step-sync succeeded",
    ]);
  });

  test("a resumed Media sync polls through lingering ingress finalizers without starting another sync", async () => {
    const f = mediaRetirementFixture();
    const sleep = vi.spyOn(Bun, "sleep").mockResolvedValue();
    try {
      const pending = {
        ...f.after,
        status: {
          ...f.after.status,
          sync: {
            status: "OutOfSync",
            revision: f.after.spec.source.targetRevision,
          },
          resources: [
            { ...f.ingress, status: "OutOfSync", requiresPruning: true },
          ],
        },
      };
      calls.reads = [
        { ...f.before, operation: f.operation },
        pending,
        f.after,
        f.after,
      ];
      calls.argoResponses.set("media?refresh=hard", [f.after, f.after]);
      calls.argoResponses.set("media/managed-resources", [
        {
          items: [
            {
              ...f.ingress,
              liveState: JSON.stringify({
                metadata: { deletionTimestamp: "2026-11-21T14:00:00Z" },
              }),
            },
          ],
        },
        { items: [] },
      ]);
      await sync(f.current, f.recipe, "step-sync");
      expect(
        calls.events.filter((event) => event.startsWith("sync-managed")),
      ).toEqual([]);
      expect(
        calls.events.filter((event) => event === "media/managed-resources"),
      ).toHaveLength(2);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(calls.events.at(-1)).toBe("step-sync succeeded");
    } finally {
      sleep.mockRestore();
    }
  });
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

  test("the Hub route guard authorizes pruning for the rendered release", async () => {
    const { current, recipe } = fixture();
    calls.hubPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(
      calls.events.find((event) => event.startsWith("sync-managed")),
    ).toContain("--prune");
    expect(calls.hubReleases).toEqual([
      expect.objectContaining({
        application: "storm-forum",
        chart: "storm-forum",
        namespace: "storm-forum",
        environmentId: "storm-forum/prod",
        revision: "1.0.1",
      }),
    ]);
  });

  test("the Hub route guard is not consulted once another guard prunes", async () => {
    const { current, recipe } = fixture();
    calls.credentialPrune = true;
    calls.reads = [application(false), application(true)];
    await sync(current, recipe, "step-sync");
    expect(calls.hubReleases).toEqual([]);
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

  test("a sync settled only by prune-pending resources records bounded evidence the API accepts", async () => {
    const { current, recipe } = fixture();
    const synced = application(true);
    if (!("operationState" in synced.status))
      throw new Error("Synced fixture lost its status");
    const names = Array.from(
      { length: 120 },
      (_, index) =>
        `temporal-delivery-wf-retained-${String(index).padStart(12, "0")}`,
    );
    const settled = {
      ...synced,
      status: {
        ...synced.status,
        sync: { ...synced.status.sync, status: "OutOfSync" },
        resources: names.map((name) => ({
          group: "apps",
          kind: "Deployment",
          namespace: "temporal",
          name,
          status: "OutOfSync",
          requiresPruning: true,
        })),
      },
    };
    calls.reads = [application(false), settled];
    await sync(current, recipe, "step-sync");
    const succeeded = calls.stages.find(({ status }) => status === "succeeded");
    if (succeeded === undefined) throw new Error("Sync stage never succeeded");
    const receipt: unknown = succeeded.receipt;
    if (
      typeof receipt !== "object" ||
      receipt === null ||
      !("evidence" in receipt) ||
      !Array.isArray(receipt.evidence)
    )
      throw new Error("Sync stage recorded no evidence");
    const evidence: { kind: string; summary: string }[] = receipt.evidence;
    // The Delivery API caps an evidence summary at 4000 chars (AI-794): the
    // full prune-pending list must be chunked, never one oversized summary.
    expect(evidence.length).toBeGreaterThan(1);
    for (const item of evidence) {
      expect(item.kind).toBe("reconciliation");
      expect(item.summary.length).toBeLessThanOrEqual(4000);
    }
    const joined = evidence.map((item) => item.summary).join("\n");
    for (const name of names) expect(joined).toContain(name);
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

describe("a failed apply-safety body write (AI-423)", () => {
  test("settles failed stage when writeBody throws without mutating spec.source or creating the Application", async () => {
    const { current, recipe } = fixture();
    calls.reads = [existingApplication(), existingApplication()];
    calls.failUpdate = true;
    const updateError = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(updateError).toBeInstanceOf(ApplicationFailure);
    expect(updateError).toMatchObject({
      type: "DeliveryApplySafetyRefused",
      nonRetryable: true,
    });
    expect(calls.stages.map(({ status }) => status)).toEqual([
      "running",
      "failed",
    ]);
    expect(calls.stages[1]?.receipt).toMatchObject({
      evidence: [
        {
          kind: "preflight",
          summary: expect.stringContaining("Argo API returned HTTP 400"),
        },
      ],
    });

    calls.stages = [];
    calls.events = [];
    calls.failUpdate = false;
    calls.failCreate = true;
    calls.reads = [null, null];
    const createError = await refusal(
      applySafety(current, recipe, "step-apply-safety"),
    );
    expect(createError).toMatchObject({
      type: "DeliveryApplySafetyRefused",
      nonRetryable: true,
    });
    expect(calls.stages.map(({ status }) => status)).toEqual([
      "running",
      "failed",
    ]);
  });

  test("retains recovery ownership when writeBody fails and readback observes mutated spec, metadata, unsettled operation, or vanished Application", async () => {
    const { current, recipe } = fixture();
    const priorWithSelfHeal = {
      ...existingApplication(),
      metadata: {
        ...existingApplication().metadata,
        annotations: {
          "delivery.shepherdjerred.com/environment": "forum/prod",
        },
      },
      spec: {
        ...existingApplication().spec,
        syncPolicy: {
          automated: { enabled: true, selfHeal: true, prune: false },
        },
      },
    };
    for (const afterRead of [
      {
        ...priorWithSelfHeal,
        spec: { source: { chart: "storm-forum", targetRevision: "1.0.1" } },
      },
      {
        // Same synced source, but full-body PUT replaced syncPolicy (disabled selfHeal).
        ...priorWithSelfHeal,
        metadata: { ...priorWithSelfHeal.metadata, resourceVersion: "8" },
        spec: {
          ...priorWithSelfHeal.spec,
          syncPolicy: { automated: { enabled: false } },
        },
      },
      {
        ...priorWithSelfHeal,
        metadata: {
          ...priorWithSelfHeal.metadata,
          annotations: { "argocd.argoproj.io/sync-options": "Prune=false" },
        },
      },
      {
        ...priorWithSelfHeal,
        status: {
          ...priorWithSelfHeal.status,
          operationState: { phase: "Running" },
        },
      },
      null,
    ]) {
      calls.stages = [];
      calls.failUpdate = true;
      calls.reads = [priorWithSelfHeal, afterRead];
      const error = await refusal(
        applySafety(current, recipe, "step-apply-safety"),
      );
      expect(error).not.toBeInstanceOf(ApplicationFailure);
      expect(calls.stages.map(({ status }) => status)).toEqual(["running"]);
    }
  });
});
