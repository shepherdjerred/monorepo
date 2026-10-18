import { expect, test } from "vitest";
import {
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
