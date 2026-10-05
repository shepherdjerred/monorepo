import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { EntityState } from "@shepherdjerred/home-assistant";
import { TASK_QUEUES } from "#shared/task-queues.ts";

let environment: TestWorkflowEnvironment;
beforeAll(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);
afterAll(async () => {
  await environment.teardown();
});

test.each(["runVacuumIfNotHome", "leavingHome"])(
  "replays %s's pre-history commands without scheduling new evidence reads",
  async (workflowType) => {
    const states = new Map<string, string>();
    const entity = (entityId: string): EntityState => ({
      entity_id: entityId,
      state: entityId.startsWith("person.")
        ? "not_home"
        : (states.get(entityId) ?? "docked"),
      attributes: {},
    });
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.HOME,
      workflowsPath: new URL(
        "../replay-fixtures/vacuum-before-history.ts",
        import.meta.url,
      ).pathname,
      activities: {
        getEntityState: async (entityId: string) => entity(entityId),
        getEntitiesInDomain: async () => [entity("light.kitchen")],
        callService: async (
          domain: string,
          service: string,
          data: Record<string, unknown>,
        ) => {
          const entityId = data["entity_id"];
          if (typeof entityId !== "string")
            throw new TypeError("Missing fixture entity_id");
          if (domain === "vacuum" && service === "start")
            states.set(entityId, "cleaning");
          else if (domain === "light" && service === "turn_off")
            states.set(entityId, "off");
          else
            throw new Error(`Unexpected fixture service ${domain}.${service}`);
        },
        sendNotification: () => Promise.resolve(),
        recordWorkflowOutcome: () => Promise.resolve(),
      },
    });
    const workflowId = `vacuum-history-replay-${workflowType}-${randomUUID()}`;
    await worker.runUntil(
      environment.client.workflow.execute(workflowType, {
        taskQueue: TASK_QUEUES.HOME,
        workflowId,
      }),
    );
    const history = await environment.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    expect(
      history.events?.some(
        (event) =>
          event.activityTaskScheduledEventAttributes?.activityType?.name ===
          "getVacuumStartEvidence",
      ),
    ).toBe(false);
    await Worker.runReplayHistory(
      { workflowsPath: new URL("../index.ts", import.meta.url).pathname },
      history,
    );
  },
  60_000,
);
