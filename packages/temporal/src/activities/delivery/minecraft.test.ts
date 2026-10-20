import { describe, expect, test, vi } from "vitest";
import {
  StageSchema,
  type StageInput,
} from "@shepherdjerred/delivery/contract";
import {
  prepareMinecraftDelivery,
  preserveDeliveryMinecraft,
  type MinecraftEffects,
} from "./minecraft.ts";
import { minecraftDetailFixture as fixture } from "./minecraft-fixtures.ts";

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
    }),
  },
}));

async function effectsFixture() {
  const detail = await fixture();
  if (
    detail.pipeline.definition.kind !== "argocd" ||
    detail.pipeline.definition.minecraftUpgrade === undefined
  )
    throw new Error("Expected the specialized Minecraft policy");
  detail.pipeline.definition.minecraftUpgrade.releaseMode = "verified-restore";
  const events: string[] = [];
  const writes: StageInput[] = [];
  const effects: MinecraftEffects = {
    async load() {
      return detail;
    },
    async eligibility() {
      return { status: "waiting", reason: "players-online", players: 2 };
    },
    async preserve(_detail, requestId, onReceipt, signal) {
      expect(signal?.aborted).toBe(false);
      await onReceipt({
        namespace: "delivery-tsmc-controller",
        name: "delivery-tsmc-controller-0",
        uid: "controller-uid",
        specFingerprint: "a".repeat(64),
        sourceFingerprint: "b".repeat(64),
        requestId,
      });
      events.push("effect");
      return {
        status: "waiting",
        reason: "players-online",
        originalReopened: true,
      };
    },
    async stage(_id, input) {
      const { evidence, ...data } = input;
      writes.push(input);
      events.push(
        input.message.startsWith("{") ? "native-receipt" : input.status,
      );
      detail.stages = detail.stages.filter((stage) => stage.key !== input.key);
      detail.stages.push(
        StageSchema.parse({
          ...data,
          id: input.key,
          deploymentId: detail.deployment.id,
          updatedAt: "2026-10-17T20:00:00.000Z",
        }),
      );
      detail.evidence.push(
        ...evidence.map((item) => ({
          ...item,
          id: `evidence/${String(detail.evidence.length)}`,
          deploymentId: detail.deployment.id,
          createdAt: "2026-10-17T20:00:00.000Z",
        })),
      );
    },
  };
  return { detail, effects, events, writes };
}

describe("TSMC preservation Activity boundaries", () => {
  test("explicit retained-volume restart skips the restoration controller but retains active-request and target checks", async () => {
    const { detail, effects, writes, events } = await effectsFixture();
    if (
      detail.pipeline.definition.kind !== "argocd" ||
      !detail.pipeline.definition.minecraftUpgrade
    )
      throw new Error("Expected the specialized Minecraft policy");
    detail.pipeline.definition.minecraftUpgrade.releaseMode =
      "retained-volume-restart";
    effects.eligibility = async () => {
      throw new Error(
        "Routine restart must not invoke the restoration controller",
      );
    };
    expect(await prepareMinecraftDelivery(detail, effects)).toEqual({
      status: "ready",
    });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
    detail.deployment.cancelRequested = true;
    await expect(prepareMinecraftDelivery(detail, effects)).rejects.toThrow(
      "canceled or superseded",
    );
    detail.deployment.cancelRequested = false;
    detail.environment.application = "minecraft-shuxin";
    await expect(prepareMinecraftDelivery(detail, effects)).rejects.toThrow(
      "reviewed TSMC target",
    );
  });
  test("occupied-server eligibility stays read-only before environment claim", async () => {
    const { detail, effects, writes, events } = await effectsFixture();
    detail.deployment.status = "queued";
    detail.environment.activeDeploymentId = null;
    expect(await prepareMinecraftDelivery(detail, effects)).toEqual({
      status: "waiting",
      reason: "players-online",
    });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });
  test("persists controller identity before effects and gives safe deferrals separate immutable attempts", async () => {
    const { detail, effects, events, writes } = await effectsFixture();
    expect(
      await preserveDeliveryMinecraft(detail.deployment.id, effects),
    ).toEqual({ status: "waiting" });
    expect(events).toEqual([
      "running",
      "native-receipt",
      "effect",
      "succeeded",
    ]);
    expect(
      writes.every((stage) =>
        stage.evidence.every((item) => item.kind !== "backup"),
      ),
    ).toBe(true);
    const request = writes[0]?.operationId;
    expect(
      await preserveDeliveryMinecraft(detail.deployment.id, effects),
    ).toEqual({ status: "waiting" });
    expect(writes.at(-1)?.key).toBe("minecraft-preservation-2");
    expect(writes.at(-1)?.operationId).toBe(request);
  });
  test("cancellation or supersession prevents another maintenance invocation", async () => {
    const { detail, effects, events } = await effectsFixture();
    detail.deployment.cancelRequested = true;
    await expect(
      preserveDeliveryMinecraft(detail.deployment.id, effects),
    ).rejects.toThrow("canceled or superseded");
    expect(events).toEqual([]);
  });
  test("failed receipt persistence prevents the runner's first effect", async () => {
    const { detail, effects, events } = await effectsFixture();
    const stage = effects.stage;
    effects.stage = async (id, input) => {
      if (input.message.startsWith("{"))
        throw new Error("receipt persistence failed");
      await stage(id, input);
    };
    await expect(
      preserveDeliveryMinecraft(detail.deployment.id, effects),
    ).rejects.toThrow("receipt persistence failed");
    expect(events).toEqual(["running"]);
  });
  test("an unreceipted runner cannot mark even a safe waiting attempt completed", async () => {
    const { detail, effects, writes } = await effectsFixture();
    effects.preserve = async () => ({
      status: "waiting",
      reason: "players-online",
      originalReopened: true,
    });
    await expect(
      preserveDeliveryMinecraft(detail.deployment.id, effects),
    ).rejects.toThrow("recording its native identity");
    expect(writes.map((input) => input.status)).toEqual(["running"]);
  });
});
