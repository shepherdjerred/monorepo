import { z } from "zod";
import type { Client } from "@temporalio/client";
import { WorkflowIdReusePolicy } from "@temporalio/client";
import type { EventEnvelope } from "@shepherdjerred/home-assistant";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const IOS_ACTION_ID_GOOD_NIGHT = "A91A15AA-479E-416C-8F51-BD983A999266";

const IosActionEventData = z.object({
  actionID: z.string(),
});

const StateChangedEventData = z.object({
  entity_id: z.string(),
  new_state: z
    .object({ state: z.string() })
    .loose()
    .nullable()
    .optional(),
  old_state: z
    .object({ state: z.string() })
    .loose()
    .nullable()
    .optional(),
});

const PERSON_ENTITIES = new Set(["person.jerred", "person.shuxin"]);

function dayKey(): string {
  const now = new Date();
  return `${String(now.getUTCFullYear())}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
}

async function startWorkflow(
  client: Client,
  workflowType: string,
  workflowId: string,
): Promise<void> {
  try {
    await client.workflow.start(workflowType, {
      taskQueue: TASK_QUEUES.DEFAULT,
      workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      workflowExecutionTimeout: "10 minutes",
      args: [],
    });
    console.warn(`Started workflow ${workflowType} id=${workflowId}`);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `Failed to start workflow ${workflowType} id=${workflowId}: ${detail}`,
    );
  }
}

export function handleIosAction(
  client: Client,
): (event: EventEnvelope) => Promise<void> {
  return async (event) => {
    const parsed = IosActionEventData.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    if (parsed.data.actionID !== IOS_ACTION_ID_GOOD_NIGHT) {
      return;
    }
    await startWorkflow(client, "goodNight", `good-night-${dayKey()}`);
  };
}

export function handleStateChanged(
  client: Client,
): (event: EventEnvelope) => Promise<void> {
  return async (event) => {
    const parsed = StateChangedEventData.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    if (!PERSON_ENTITIES.has(parsed.data.entity_id)) {
      return;
    }
    const oldState = parsed.data.old_state?.state;
    const newState = parsed.data.new_state?.state;
    if (oldState === undefined || newState === undefined) {
      return;
    }
    if (oldState === "not_home" && newState === "home") {
      await startWorkflow(
        client,
        "welcomeHome",
        `welcome-home-${dayKey()}-${parsed.data.entity_id}`,
      );
      return;
    }
    if (oldState === "home" && newState === "not_home") {
      await startWorkflow(
        client,
        "leavingHome",
        `leaving-home-${dayKey()}-${parsed.data.entity_id}`,
      );
    }
  };
}
