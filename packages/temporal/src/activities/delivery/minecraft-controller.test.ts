import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, chmod, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  StageSchema,
  MinecraftRecoveryIntentSchema,
} from "@shepherdjerred/delivery/contract";
import {
  minecraftDetailFixture,
  minecraftSourceJournalFixture,
} from "./minecraft-fixtures.ts";
import { createMinecraftControllerServer } from "#lib/delivery/minecraft-controller-server.ts";
import {
  MinecraftControllerProcess,
  type MinecraftControllerInput,
} from "#lib/delivery/minecraft-controller-process.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { minecraftRuntimeImage } from "#lib/delivery/minecraft.ts";
import { minecraftRecoveryControllerOrigin } from "#lib/delivery/minecraft-controller.ts";

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function workspace() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delivery-minecraft-controller-"),
  );
  temporary.push(directory);
  return directory;
}
const identity = {
  namespace: "delivery-tsmc-controller",
  name: "delivery-tsmc-controller-0",
  uid: "native-controller-pod-1",
} as const;

test("operator recovery accepts only the exact loopback port-forward bootstrap", () => {
  expect(minecraftRecoveryControllerOrigin("http://127.0.0.1:17356")).toBe(
    "http://127.0.0.1:17356",
  );
  for (const url of [
    "https://controller.example",
    "http://127.0.0.1",
    "http://localhost:17356",
    "http://127.0.0.1:17356/requests",
    "http://user:credential@127.0.0.1:17356",
    "http://127.0.0.1:17356?token=unreviewed",
  ])
    expect(() => minecraftRecoveryControllerOrigin(url)).toThrow(
      "loopback-only",
    );
});

test("HTTP requires native receipt persistence and fresh PG cancellation fence before any preservation effect", async () => {
  const detail = await minecraftDetailFixture();
  const requestId = deliveryOperationId(
    `${detail.deployment.id}:minecraft-preservation`,
  );
  detail.stages = [
    StageSchema.parse({
      id: "stage/1",
      deploymentId: detail.deployment.id,
      key: "minecraft-preservation-1",
      status: "running",
      operationId: requestId,
      message: "Awaiting native identity",
      updatedAt: new Date().toISOString(),
    }),
  ];
  const receipt = {
    ...identity,
    requestId,
    specFingerprint: "a".repeat(64),
    sourceFingerprint: "b".repeat(64),
  };
  const effects: string[] = [];
  const app = createMinecraftControllerServer({
    token: "local-controller-executor-token",
    toolingRevision: "f".repeat(40),
    load: async () => detail,
    admit: async () => detail,
    loadRecovery: async () => {
      throw new Error("No recovery intent in ordinary fixture");
    },
    process: {
      prepare: async () => {
        effects.push("prepare");
        return receipt;
      },
      run: async (_input, command) => {
        effects.push(command);
        return {
          status: "waiting",
          reason: "players-online",
          originalReopened: true,
        };
      },
    },
  });
  const call = async (
    command: string,
    authenticated = true,
    body?: unknown,
  ) => {
    const response = await app.request(`/requests/${requestId}/${command}`, {
      method: "POST",
      headers: {
        ...(authenticated
          ? { authorization: "Bearer local-controller-executor-token" }
          : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? { deploymentId: detail.deployment.id }),
    });
    return response.status;
  };
  expect(await call("verify", false)).toBe(401);
  expect(effects).toEqual([]);
  expect(await call("prepare")).toBe(200);
  expect(await call("verify")).toBe(500);
  expect(effects).not.toContain("verify");
  detail.stages[0]!.message = JSON.stringify(receipt);
  expect(await call("verify")).toBe(200);
  expect(effects.filter((effect) => effect === "verify")).toHaveLength(1);
  detail.deployment.cancelRequested = true;
  expect(await call("verify")).toBe(500);
  expect(effects.filter((effect) => effect === "verify")).toHaveLength(1);
  expect(
    await call("prepare", true, {
      deploymentId: detail.deployment.id,
      image: "forged",
    }),
  ).toBe(500);
});

test("durable controller identity survives restart, rejects changed candidate/tooling, and passes no service credentials to Python", async () => {
  const journalRoot = await workspace();
  const detail = await minecraftDetailFixture();
  const input: MinecraftControllerInput = {
    deploymentId: detail.deployment.id,
    requestId: deliveryOperationId(
      `${detail.deployment.id}:minecraft-preservation`,
    ),
    versionSetRevisionId: detail.deployment.versionSetRevisionId,
    toolingRevision: "f".repeat(40),
    candidateImage: minecraftRuntimeImage(detail),
    runtimeDigests: [],
  };
  const closure = {
    journalRoot,
    producerRoot: "/reviewed/source/server",
    identity: async () => identity,
    process: async (
      command: string[],
      environment: Record<string, string | undefined>,
    ) => {
      expect(Object.keys(environment).sort()).toEqual([
        "HOME",
        "KUBECONFIG",
        "PATH",
        "TMPDIR",
      ]);
      expect(command.slice(0, 2)).toEqual([
        "python3",
        "/reviewed/source/server/delivery_validation.py",
      ]);
      if (command[2] === "snapshot") {
        const file = command[command.indexOf("--journal") + 1];
        if (file === undefined)
          throw new Error("Missing original source journal");
        const existing = Bun.file(file);
        if (!(await existing.exists())) {
          await Bun.write(
            file,
            JSON.stringify(
              minecraftSourceJournalFixture(
                input.requestId,
                input.candidateImage,
              ),
            ),
          );
          await chmod(file, 0o600);
        }
        return JSON.stringify({
          status: "PREPARED_SOURCE",
          requestId: input.requestId,
          journalSha256: "d".repeat(64),
        });
      }
      expect(command[2]).toBe("verify");
      const receipt = command[command.indexOf("--receipt") + 1];
      if (receipt === undefined)
        throw new Error("Missing private receipt path");
      const bytes = JSON.stringify({ native: "private-preservation-proof" });
      await Bun.write(receipt, bytes);
      await chmod(receipt, 0o600);
      return JSON.stringify({
        status: "VERIFIED",
        requestId: input.requestId,
        receiptSha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
  };
  const first = await new MinecraftControllerProcess(closure).prepare(input);
  const restarted = new MinecraftControllerProcess(closure);
  expect(await restarted.prepare(input)).toEqual(first);
  const metadata = await stat(
    path.join(journalRoot, "requests", input.requestId, "operation.json"),
  );
  expect(metadata.mode & 0o077).toBe(0);
  await expect(
    restarted.prepare({ ...input, toolingRevision: "e".repeat(40) }),
  ).rejects.toThrow("different immutable inputs");
  await expect(
    restarted.prepare({
      ...input,
      candidateImage: `docker.io/shepherdjerred/the-storm-server:other@sha256:${"c".repeat(64)}`,
    }),
  ).rejects.toThrow("different immutable inputs");
  const result = await restarted.run(input, "verify");
  expect(result).toMatchObject({
    requestId: input.requestId,
    receiptJson: JSON.stringify({ native: "private-preservation-proof" }),
  });
  const world = path.join(
    journalRoot,
    "requests",
    input.requestId,
    "world.json",
  );
  const journal = minecraftSourceJournalFixture(
    input.requestId,
    input.candidateImage,
  );
  journal.claimUid = "replacement-claim";
  await Bun.write(world, JSON.stringify(journal));
  await expect(restarted.prepare(input, true)).rejects.toThrow(
    "Original Minecraft source snapshot changed",
  );
  await rm(world);
  await expect(restarted.prepare(input, true)).rejects.toThrow();
});

test("recovery accepts completed preservation or a missing callback only through the same pending admin quarantine", async () => {
  const detail = await minecraftDetailFixture();
  const requestId = deliveryOperationId(
    `${detail.deployment.id}:minecraft-preservation`,
  );
  detail.deployment.status = "failed";
  detail.deployment.recoveryRequired = true;
  detail.deployment.cancelRequested = true;
  detail.stages = [
    StageSchema.parse({
      id: "stage/completed",
      deploymentId: detail.deployment.id,
      key: "minecraft-preservation-1",
      status: "succeeded",
      operationId: requestId,
      message: "Completed before executor restart",
      updatedAt: new Date().toISOString(),
    }),
  ];
  const receipt = {
    ...identity,
    requestId,
    specFingerprint: "a".repeat(64),
    sourceFingerprint: "b".repeat(64),
  };
  const intent = MinecraftRecoveryIntentSchema.parse({
    id: "recovery/1",
    deploymentId: detail.deployment.id,
    requestedBy: "admin",
    reason: "Recover the unchanged original before selecting another source",
    expectedEnvironmentGeneration: detail.environment.generation,
    snapshotFingerprint: "c".repeat(64),
    controllerReceipt: null,
    status: "pending",
    workflowId: "delivery-minecraft-recovery/recovery/1",
    submittedAt: null,
    message: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  });
  const effects: string[] = [];
  const app = createMinecraftControllerServer({
    token: "local-controller-executor-token",
    toolingRevision: "f".repeat(40),
    load: async () => detail,
    admit: async () => {
      throw new Error("Recovery must never claim or select a source");
    },
    loadRecovery: async () => ({ intent, deployment: detail }),
    process: {
      prepare: async (_input, recovery) => {
        expect(recovery).toBe(true);
        effects.push("prepare-original");
        return receipt;
      },
      run: async (_input, command) => {
        effects.push(command);
        return { testOnly: "native report transport" };
      },
    },
  });
  const call = async (command: string, includeIntent = true) => {
    const response = await app.request(`/requests/${requestId}/${command}`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-controller-executor-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deploymentId: detail.deployment.id,
        ...(includeIntent ? { recoveryId: intent.id } : {}),
      }),
    });
    return response.status;
  };
  expect(await call("recover", false)).toBe(500);
  expect(await call("verify")).toBe(500);
  expect(effects).toEqual([]);
  expect(await call("prepare-recovery")).toBe(200);
  expect(await call("recover")).toBe(500);
  expect(effects).toEqual(["prepare-original"]);
  intent.controllerReceipt = receipt;
  expect(await call("recover")).toBe(200);
  const prepared = effects.filter(
    (effect) => effect === "prepare-original",
  ).length;
  expect(await call("report")).toBe(200);
  expect(
    effects.filter((effect) => effect === "prepare-original"),
  ).toHaveLength(prepared);
  detail.stages.push(
    StageSchema.parse({
      ...detail.stages[0],
      id: "stage/source",
      key: "reconcile",
      status: "running",
    }),
  );
  expect(await call("recover")).toBe(500);
  expect(effects.filter((effect) => effect === "recover")).toHaveLength(1);
  detail.stages = [];
  // An interrupted callback need not leave a running Stage, but the original journal is still mandatory in the real process.
  expect(await call("recover")).toBe(200);
  detail.environment.generation++;
  expect(await call("report")).toBe(500);
});
