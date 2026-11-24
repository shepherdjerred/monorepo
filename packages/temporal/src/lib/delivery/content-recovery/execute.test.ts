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
import { executeContentRecovery } from "./execute.ts";

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
