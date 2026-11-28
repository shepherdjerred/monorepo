import { expect, test } from "vitest";
import { Connection } from "@temporalio/client";
import {
  ContentBarrierRestorationSchema,
  ContentRecoveryContextSchema,
  ContentRecoveryOwnershipSchema,
  DispatchBarrierSchema,
} from "@shepherdjerred/delivery/contract";
import { minecraftDetailFixture } from "#activities/delivery/minecraft-fixtures.ts";
import type { deliveryRequest } from "#lib/delivery/client.ts";
import {
  executeContentRecovery,
  type ContentOperatorEffects,
} from "#lib/delivery/content-recovery/execute.ts";
import {
  contentFingerprint,
  contentOwnership,
} from "#lib/delivery/content-recovery/ownership.ts";
import { restoreContentDispatch } from "#lib/delivery/content-recovery/restoration.ts";
import type { BarrierEffects } from "#lib/delivery/platform/control-plane-barrier.ts";

async function fixture() {
  const detail = await minecraftDetailFixture();
  detail.pipeline.definition = {
    kind: "static-site",
    archiveComponent: "site:wiki-sjer-red",
    bucket: "wiki-sjer-red",
    cloudflareZoneId: "879487f81194d63121d0b8dddd16f08f",
    immutablePrefixes: ["_astro/"],
    extraExcludes: [],
    entrypoints: ["index.html"],
    verification: { url: "https://wiki.sjer.red/", expectedStatus: 200 },
  };
  detail.deployment.status = "failed";
  detail.deployment.recoveryRequired = true;
  const context = ContentRecoveryContextSchema.parse({
    intent: {
      id: "operator/non-uuid",
      deploymentId: detail.deployment.id,
      requestedBy: "admin",
      reason: "Inspect exact original native content and ownership",
      expectedEnvironmentGeneration: 1,
      snapshotFingerprint: "a".repeat(64),
      status: "pending",
      message: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      targetKind: "static-site",
      nativeReceipts: [],
      dispatchBarrier: null,
      barrierRestoredAt: null,
    },
    deployment: detail,
    priorDeployment: null,
    expectedSettlements: { desired: "b".repeat(64) },
    recoveryHistory: [],
  });
  const events: string[] = [];
  let replicas = 1;
  let badReadback = false;
  let staleReadback = false;
  const api: typeof deliveryRequest = async (path, schema, body) => {
    if (path.endsWith("/barrier")) {
      events.push("checkpoint");
      context.intent.dispatchBarrier = DispatchBarrierSchema.parse(body);
      return schema.parse(context.intent);
    }
    if (path.endsWith("/complete")) {
      events.push("complete");
      context.intent.status = "succeeded";
      return schema.parse(context.intent);
    }
    return schema.parse(context);
  };
  const effects: ContentOperatorEffects = {
    paused: async () => {
      events.push("paused");
    },
    original: async () => {
      events.push("original");
    },
    fence: async () => {
      events.push("closed-and-terminal");
    },
    barrier: (_context, checkpoint, fence) => ({
      checkpoint,
      fence,
      read: async () => ({
        metadata: {
          name: "temporal-delivery-worker",
          namespace: "temporal",
          uid: "host",
          resourceVersion: "1",
        },
        spec: { replicas, template: {} },
        status: { replicas },
      }),
      pods: async () =>
        replicas === 0
          ? []
          : [
              {
                metadata: {
                  uid: "old-pod",
                  labels: { component: "delivery-worker" },
                  ownerReferences: [
                    { kind: "ReplicaSet", uid: "rs", controller: true },
                  ],
                },
              },
            ],
      replicaSet: async () => ({
        metadata: {
          uid: "rs",
          ownerReferences: [
            { kind: "Deployment", uid: "host", controller: true },
          ],
        },
      }),
      patch: async () => {
        events.push("stop");
        replicas = 0;
      },
      wait: () => Promise.resolve(),
    }),
    ownership: async () => {
      events.push("fresh-native-proof");
      return ContentRecoveryOwnershipSchema.parse({
        expectedEnvironmentGeneration: 1,
        snapshotFingerprint: context.intent.snapshotFingerprint,
        observedAt: new Date().toISOString(),
        sourceWorkflow: {
          workflowId: `delivery/${detail.deployment.id}`,
          status: "FAILED",
        },
        nativeJobs: [],
        quiescence: {
          deploymentUID: "host",
          templateFingerprint: "c".repeat(64),
          replicas: 0,
          remainingPodUIDs: [],
          journalFingerprint: "d".repeat(64),
        },
      });
    },
    repair: async () => {
      events.push("repair");
    },
    inspectPrior: async () => {
      throw new Error("Prior Forum inspection must not run for a static site");
    },
    inspect: async () => {
      events.push("independent-readback");
      if (badReadback) throw new Error("actual public bytes differ");
      return {
        observedAt: new Date(
          Date.now() - (staleReadback ? 120_000 : 0),
        ).toISOString(),
      };
    },
    restore: async () => {
      events.push("restore");
      replicas = 1;
    },
  };
  return {
    context,
    events,
    api,
    effects,
    replicas: () => replicas,
    bad: () => {
      badReadback = true;
    },
    good: () => {
      badReadback = false;
    },
    stale: () => {
      staleReadback = true;
    },
  };
}

test("operator repairs only after durable stop and settles from independent readback, preserving failed result", async () => {
  const f = await fixture();
  await executeContentRecovery(f.context.intent.id, "repair", f.effects, f.api);
  expect(f.events.indexOf("checkpoint")).toBeLessThan(f.events.indexOf("stop"));
  expect(f.events.indexOf("stop")).toBeLessThan(f.events.indexOf("repair"));
  expect(f.events.slice(-5)).toEqual([
    "repair",
    "independent-readback",
    "fresh-native-proof",
    "complete",
    "restore",
  ]);
  expect(f.context.deployment.deployment.status).toBe("failed");
  expect(
    f.context.deployment.environment.acceptedVersionSetRevisionId,
  ).toBeNull();
});

test("failed public/native readback retains zero-replica quarantine and same intent can inspect after manual settlement", async () => {
  const f = await fixture();
  f.bad();
  await expect(
    executeContentRecovery(f.context.intent.id, "repair", f.effects, f.api),
  ).rejects.toThrow("bytes differ");
  expect(f.replicas()).toBe(0);
  expect(f.events).not.toContain("complete");
  expect(f.events).not.toContain("restore");
  f.good();
  await executeContentRecovery(
    f.context.intent.id,
    "inspect",
    f.effects,
    f.api,
  );
  expect(f.events.filter((value) => value === "repair")).toHaveLength(1);
  expect(f.events.at(-1)).toBe("restore");
});

test("paused schedule and exact original native proof are mandatory before any stop or repair", async () => {
  const f = await fixture();
  f.effects.fence = () =>
    Promise.reject(new Error("original Pod remains live"));
  await expect(
    executeContentRecovery(f.context.intent.id, "repair", f.effects, f.api),
  ).rejects.toThrow("Pod remains live");
  expect(f.events).not.toContain("stop");
  expect(f.events).not.toContain("repair");
});

test("expired target readback cannot borrow a fresh ownership timestamp", async () => {
  const f = await fixture();
  f.stale();
  await expect(
    executeContentRecovery(f.context.intent.id, "inspect", f.effects, f.api),
  ).rejects.toThrow("expired");
  expect(f.events).not.toContain("complete");
  expect(f.events).not.toContain("restore");
});

test("lost restoration acknowledgement resumes succeeded intent without replaying effects or acceptance", async () => {
  const f = await fixture();
  await executeContentRecovery(
    f.context.intent.id,
    "inspect",
    f.effects,
    f.api,
  );
  f.events.length = 0;
  await executeContentRecovery(f.context.intent.id, "repair", f.effects, f.api);
  expect(f.events).toEqual(["paused", "restore"]);
});

test("contentOwnership and restoreContentDispatch preserve frozen expectedEnvironmentGeneration on succeeded intents", async () => {
  const f = await fixture();
  f.context.intent.expectedEnvironmentGeneration = 100;
  f.context.intent.dispatchBarrier = DispatchBarrierSchema.parse({
    adapter: "control-plane-dispatch-barrier/v1",
    deploymentUID: "host",
    templateFingerprint: contentFingerprint({}),
    priorReplicas: 1,
    podUIDs: ["old-pod"],
    replicaSetUIDs: ["old-rs"],
  });

  let replicas = 0;
  const barrier: BarrierEffects = {
    read: async () => ({
      metadata: {
        name: "temporal-delivery-worker",
        namespace: "temporal",
        uid: "host",
        resourceVersion: "1",
      },
      spec: { replicas, template: {} },
      status: { replicas, readyReplicas: replicas },
    }),
    pods: async () =>
      replicas === 0
        ? []
        : [
            {
              metadata: {
                uid: "new-pod",
                labels: { component: "delivery-worker" },
                ownerReferences: [
                  { kind: "ReplicaSet", uid: "new-rs", controller: true },
                ],
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
              },
            },
          ],
    replicaSet: async (uid) => ({
      metadata: {
        uid,
        ownerReferences: [
          { kind: "Deployment", uid: "host", controller: true },
        ],
      },
    }),
    patch: async () => {
      replicas = 1;
    },
    checkpoint: () => Promise.resolve(),
    fence: () => Promise.resolve(),
    wait: () => Promise.resolve(),
  };
  const read = {
    job: () => Promise.reject(new Error("no native jobs expected")),
    pods: () => Promise.resolve([]),
  };
  const sourceWorkflow = (_connection: Connection, id: string) =>
    Promise.resolve({
      workflowId: `delivery/${id}`,
      status: "FAILED" as const,
    });
  const lazyConnection = Connection.lazy({ address: "127.0.0.1:7233" });

  const pendingProof = await contentOwnership(f.context, lazyConnection, read, {
    barrier,
    sourceWorkflow,
  });
  expect(pendingProof.expectedEnvironmentGeneration).toBe(100);

  f.context.intent.status = "succeeded";
  const succeededProof = await contentOwnership(
    f.context,
    lazyConnection,
    read,
    {
      barrier,
      sourceWorkflow,
    },
  );
  expect(succeededProof.expectedEnvironmentGeneration).toBe(100);

  const admitGenerations: number[] = [];
  const restoredGenerations: number[] = [];
  const api: typeof deliveryRequest = (path, schema, body) => {
    if (path.endsWith("/admit-restore")) {
      const parsed = ContentRecoveryOwnershipSchema.parse(body);
      admitGenerations.push(parsed.expectedEnvironmentGeneration);
      return Promise.resolve(schema.parse(f.context.intent));
    }
    if (path.endsWith("/restored")) {
      const parsed = ContentBarrierRestorationSchema.parse(body);
      restoredGenerations.push(parsed.expectedEnvironmentGeneration);
      f.context.intent.barrierRestoredAt = parsed.observedAt;
      return Promise.resolve(schema.parse(f.context.intent));
    }
    return Promise.resolve(schema.parse(f.context));
  };

  await restoreContentDispatch(f.context, lazyConnection, read, {
    api,
    effects: barrier,
    sourceWorkflow,
  });
  await lazyConnection.close();

  expect(admitGenerations).toEqual([100, 100]);
  expect(restoredGenerations).toEqual([100]);
  expect(f.context.intent.barrierRestoredAt).not.toBeNull();
});
