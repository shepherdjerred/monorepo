import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { EntityState } from "@shepherdjerred/home-assistant";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { MOTION_LIGHT_ROOMS } from "#shared/motion-light.ts";
import { motionLight } from "./motion-light.ts";

const TASK_QUEUE = "motion-light-test";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

describe("motionLight", () => {
  test("turns on the room light and waits for inactivity before turning it off", async () => {
    const calls: string[] = [];
    const motionStates = new Map<string, string[]>([
      [MOTION_LIGHT_ROOMS.laundry.motionEntityId, ["on", "off", "off"]],
      [MOTION_LIGHT_ROOMS.storage.motionEntityId, ["off", "off"]],
    ]);

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("../index.ts", import.meta.url).pathname,
      activities: {
        getEntityState: async (entityId: string) => {
          const states = motionStates.get(entityId);
          if (states === undefined) {
            throw new Error(`Unexpected entity state read: ${entityId}`);
          }
          const state = states.shift();
          if (state === undefined) {
            throw new Error(`Unexpected extra entity state read: ${entityId}`);
          }
          return {
            entity_id: entityId,
            state,
            attributes: {},
          } satisfies EntityState;
        },
        callService: async (
          domain: string,
          service: string,
          data: Record<string, unknown>,
        ) => {
          const entityId = data["entity_id"];
          if (typeof entityId !== "string") {
            throw new TypeError("Expected entity_id in switch service call");
          }
          calls.push(`${domain}.${service}:${entityId}`);
        },
      },
    });

    await worker.runUntil(async () => {
      await testEnv.client.workflow.execute(motionLight, {
        args: ["laundry"],
        taskQueue: TASK_QUEUE,
        workflowId: crypto.randomUUID(),
      });
      await testEnv.client.workflow.execute(motionLight, {
        args: ["storage"],
        taskQueue: TASK_QUEUE,
        workflowId: crypto.randomUUID(),
      });
    });

    expect(calls).toEqual([
      "switch.turn_on:switch.laundry_light",
      "switch.turn_off:switch.laundry_light",
      "switch.turn_on:switch.storage_light",
      "switch.turn_off:switch.storage_light",
    ]);
  }, 60_000);
});
