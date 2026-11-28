import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ContentRecoveryContextSchema,
  type ContentRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import {
  artifact,
  detail,
  recipe,
  timestamp,
} from "#lib/delivery/model/testing.ts";
import {
  executeContentRecovery,
  type ContentOperatorEffects,
} from "./execute.ts";

const chart = artifact({
  id: "chart/1",
  component: "chart:arcade",
  kind: "chart",
  uri: "oci://registry.example/arcade",
  version: "1.0.0",
  character: "b",
});

const barrier = {
  adapter: "control-plane-dispatch-barrier/v1" as const,
  deploymentUID: "uid-worker",
  templateFingerprint: "c".repeat(64),
  priorReplicas: 1 as const,
  podUIDs: ["pod-1"],
  replicaSetUIDs: ["rs-1"],
};

const appRecipe = recipe(
  { repoURL: "https://registry.example/charts", chart: "arcade" },
  "chart:arcade",
);

function makeContext(overrides: {
  status?: "pending" | "succeeded";
  withBarrier?: boolean;
  barrierRestoredAt?: string | null;
}): ContentRecoveryContext {
  const target = detail(appRecipe, chart);
  target.deployment.status = "failed";
  target.deployment.recoveryRequired = true;
  return ContentRecoveryContextSchema.parse({
    intent: {
      id: "intent/1",
      deploymentId: target.deployment.id,
      requestedBy: "operator",
      reason: "Inspect content target with journaled producer barrier",
      expectedEnvironmentGeneration: 1,
      snapshotFingerprint: "a".repeat(64),
      status: overrides.status ?? "pending",
      message: null,
      createdAt: timestamp,
      finishedAt: overrides.status === "succeeded" ? timestamp : null,
      targetKind: "static-site",
      nativeReceipts: [],
      dispatchBarrier: overrides.withBarrier === true ? barrier : null,
      barrierRestoredAt: overrides.barrierRestoredAt ?? null,
    },
    deployment: target,
    priorDeployment: null,
    expectedSettlements: { desired: "d".repeat(64) },
    recoveryHistory: [],
  });
}

describe("executeContentRecovery (AI-845)", () => {
  it("passes the loaded recovery context to paused() on entry and during barrier fencing", async () => {
    let current = makeContext({ withBarrier: false });
    const seenBarriers: boolean[] = [];
    let pausedHost = false;
    const host = () => ({
      metadata: {
        name: "temporal-delivery-worker",
        namespace: "temporal",
        uid: "uid-worker",
        resourceVersion: "1",
      },
      spec: { replicas: pausedHost ? 0 : 1, template: { spec: {} } },
      status: { replicas: 0, readyReplicas: 0 },
    });
    const activePod = {
      metadata: {
        uid: "pod-1",
        labels: { component: "delivery-worker" },
        ownerReferences: [
          { kind: "ReplicaSet", uid: "rs-1", controller: true },
        ],
      },
    };
    const replicaSet = {
      metadata: {
        uid: "rs-1",
        ownerReferences: [
          { kind: "Deployment", uid: "uid-worker", controller: true },
        ],
      },
    };
    const restore = vi.fn(async () => {
      current = makeContext({
        status: "succeeded",
        withBarrier: true,
        barrierRestoredAt: new Date().toISOString(),
      });
    });

    const result = await executeContentRecovery(
      "intent/1",
      "inspect",
      {
        paused: async (ctx) => {
          seenBarriers.push(ctx.intent.dispatchBarrier !== null);
        },
        original: () => Promise.resolve(),
        fence: () => Promise.resolve(),
        barrier: (_ctx, checkpoint, fence) => ({
          read: async () => host(),
          pods: async () => (pausedHost ? [] : [activePod]),
          replicaSet: async () => replicaSet,
          patch: async () => {
            pausedHost = true;
          },
          checkpoint: async (journal) => {
            await checkpoint(journal);
            current = {
              ...current,
              intent: { ...current.intent, dispatchBarrier: journal },
            };
          },
          fence,
          wait: () => Promise.resolve(),
        }),
        ownership: async (ctx) => ({
          expectedEnvironmentGeneration:
            ctx.intent.expectedEnvironmentGeneration,
          snapshotFingerprint: ctx.intent.snapshotFingerprint,
          observedAt: new Date().toISOString(),
          sourceWorkflow: {
            workflowId: `delivery/${ctx.deployment.deployment.id}`,
            status: "FAILED",
          },
          quiescence: {
            deploymentUID: "uid-worker",
            templateFingerprint: "c".repeat(64),
            replicas: 0,
            remainingPodUIDs: [],
            journalFingerprint: "e".repeat(64),
          },
          nativeJobs: [],
        }),
        repair: () => Promise.resolve(),
        inspect: async () => ({ observedAt: new Date().toISOString() }),
        inspectPrior: async () => {
          throw new Error("Desired inspection must not inspect prior");
        },
        restore,
      },
      async (route, schema) => {
        if (route === "content-recovery/intent%2F1")
          return schema.parse(current);
        if (route.endsWith("/complete")) {
          current = makeContext({ status: "succeeded", withBarrier: true });
        }
        return schema.parse({});
      },
    );

    expect(result).toEqual({
      status: "settled",
      originalDeploymentResult: "unchanged",
    });
    // Initial entry & pre-barrier fence saw dispatchBarrier === null; post-checkpoint fences saw dispatchBarrier !== null.
    expect(seenBarriers[0]).toBe(false);
    expect(seenBarriers.at(-1)).toBe(true);
    expect(restore).toHaveBeenCalledOnce();
  });

  it("resumes restoration of an already-succeeded intent with its held barrier context passed to paused()", async () => {
    const settled = makeContext({ status: "succeeded", withBarrier: true });
    const paused = vi.fn(async (ctx: ContentRecoveryContext) => {
      expect(ctx.intent.dispatchBarrier).not.toBeNull();
    });
    const restore = vi.fn(() => Promise.resolve());
    const result = await executeContentRecovery(
      "intent/1",
      "inspect",
      {
        paused,
        original: async () => {
          throw new Error("Settled intent must not replay original");
        },
        fence: () => Promise.resolve(),
        barrier: () => {
          throw new Error("Settled intent must not re-journal barrier");
        },
        ownership: async () => {
          throw new Error("Settled intent only restores");
        },
        repair: () => Promise.resolve(),
        inspect: async () => {
          throw new Error("Settled intent only restores");
        },
        inspectPrior: async () => {
          throw new Error("Settled intent only restores");
        },
        restore,
      },
      async (_route, schema) => schema.parse(settled),
    );
    expect(result).toEqual({
      status: "settled",
      originalDeploymentResult: "unchanged",
    });
    expect(paused).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });
});

const priorFingerprint = "b".repeat(64);
const stoppedTemplate = { spec: {} };
const recordedBarrier = {
  ...barrier,
  templateFingerprint: createHash("sha256")
    .update(JSON.stringify(stoppedTemplate))
    .digest("hex"),
};

function makeForumContext(): ContentRecoveryContext {
  const initial = makeContext({});
  const definition = {
    ...appRecipe,
    steps: [
      ...appRecipe.steps,
      {
        kind: "forum-bundle",
        instance: "application:arcade",
        imageComponent: "image:arcade",
        bundleComponent: "archive:forum",
      },
    ],
  };
  const current = detail(definition, chart);
  const prior = detail(definition, chart);
  prior.deployment.id = "deployment/prior";
  prior.deployment.status = "succeeded";
  current.deployment.status = "failed";
  current.deployment.recoveryRequired = true;
  current.deployment.previousAcceptedDeploymentId = prior.deployment.id;
  current.environment.acceptedDeploymentId = prior.deployment.id;
  return ContentRecoveryContextSchema.parse({
    ...initial,
    intent: {
      ...initial.intent,
      targetKind: "forum",
      dispatchBarrier: recordedBarrier,
    },
    deployment: current,
    priorDeployment: prior,
    expectedSettlements: {
      desired: initial.expectedSettlements.desired,
      prior: priorFingerprint,
    },
  });
}

function priorEffects() {
  const observedAt = new Date().toISOString();
  return {
    paused: vi.fn(() => Promise.resolve()),
    original: vi.fn(() => Promise.resolve()),
    fence: vi.fn(() => Promise.resolve()),
    barrier: vi.fn<ContentOperatorEffects["barrier"]>(
      (_context, checkpoint, fence) => ({
        read: async () => ({
          metadata: {
            name: "temporal-delivery-worker",
            namespace: "temporal",
            uid: recordedBarrier.deploymentUID,
            resourceVersion: "1",
          },
          spec: { replicas: 0, template: stoppedTemplate },
        }),
        pods: async () => [],
        replicaSet: () => Promise.reject(new Error("Host already stopped")),
        patch: () => Promise.reject(new Error("Host already stopped")),
        checkpoint,
        fence,
        wait: () => Promise.resolve(),
      }),
    ),
    ownership: vi.fn<ContentOperatorEffects["ownership"]>(async (context) => ({
      expectedEnvironmentGeneration:
        context.intent.expectedEnvironmentGeneration,
      snapshotFingerprint: context.intent.snapshotFingerprint,
      observedAt,
      sourceWorkflow: {
        workflowId: `delivery/${context.deployment.deployment.id}`,
        status: "FAILED",
      },
      quiescence: {
        deploymentUID: recordedBarrier.deploymentUID,
        templateFingerprint: recordedBarrier.templateFingerprint,
        replicas: 0,
        remainingPodUIDs: [],
        journalFingerprint: "e".repeat(64),
      },
      nativeJobs: [],
    })),
    repair: vi.fn(() =>
      Promise.reject(new Error("Prior inspection cannot repair")),
    ),
    inspect: vi.fn(() =>
      Promise.reject(new Error("Prior inspection cannot inspect desired")),
    ),
    inspectPrior: vi.fn<ContentOperatorEffects["inspectPrior"]>(async () => ({
      observedAt,
    })),
    restore: vi.fn(() => Promise.resolve()),
  } satisfies ContentOperatorEffects;
}

describe("inspect-prior", () => {
  it("settles only the verified frozen prior and restores the original barrier", async () => {
    const pending = makeForumContext();
    const effects = priorEffects();
    let current = pending;
    let completed: unknown;

    await executeContentRecovery(
      "intent/1",
      "inspect-prior",
      effects,
      async (route, schema, input) => {
        if (route.endsWith("/complete")) {
          completed = input;
          current = {
            ...pending,
            intent: {
              ...pending.intent,
              status: "succeeded",
              finishedAt: timestamp,
            },
          };
        }
        return schema.parse(current);
      },
    );

    expect(effects.original).toHaveBeenCalledOnce();
    expect(effects.fence).toHaveBeenCalled();
    expect(effects.inspectPrior).toHaveBeenCalledExactlyOnceWith(
      pending,
      pending.priorDeployment,
    );
    expect(effects.ownership).toHaveBeenCalledExactlyOnceWith(pending);
    expect(completed).toMatchObject({
      snapshotFingerprint: pending.intent.snapshotFingerprint,
      settlement: { state: "prior", fingerprint: priorFingerprint },
    });
    expect(effects.repair).not.toHaveBeenCalled();
    expect(effects.inspect).not.toHaveBeenCalled();
    expect(effects.restore).toHaveBeenCalledExactlyOnceWith(current);
  });

  it.each([
    "other target",
    "missing prior",
    "missing fingerprint",
    "different accepted deployment",
    "different environment generation",
  ])("refuses %s before operator effects", async (reason) => {
    const context = makeForumContext();
    if (reason === "other target") context.intent.targetKind = "static-site";
    if (reason === "missing prior") context.priorDeployment = null;
    if (reason === "missing fingerprint")
      delete context.expectedSettlements.prior;
    if (reason === "different accepted deployment")
      context.deployment.environment.acceptedDeploymentId =
        "deployment/another";
    if (reason === "different environment generation")
      context.deployment.environment.generation += 1;
    const effects = priorEffects();

    await expect(
      executeContentRecovery(
        "intent/1",
        "inspect-prior",
        effects,
        async (_route, schema) => schema.parse(context),
      ),
    ).rejects.toThrow(/requires/);
    expect(effects.paused).not.toHaveBeenCalled();
    expect(effects.original).not.toHaveBeenCalled();
    expect(effects.barrier).not.toHaveBeenCalled();
  });

  it("refuses a prior fingerprint change during readback before settling or restoring", async () => {
    const context = makeForumContext();
    const effects = priorEffects();
    effects.inspectPrior.mockImplementationOnce(async () => {
      context.expectedSettlements.prior = "f".repeat(64);
      return { observedAt: new Date().toISOString() };
    });
    const api: NonNullable<
      Parameters<typeof executeContentRecovery>[3]
    > = async (route, schema) => {
      expect(route).toBe("content-recovery/intent%2F1");
      return schema.parse(context);
    };
    await expect(
      executeContentRecovery("intent/1", "inspect-prior", effects, api),
    ).rejects.toThrow(
      /frozen prior Forum release or content quarantine changed/,
    );
    expect(effects.restore).not.toHaveBeenCalled();
  });
});
