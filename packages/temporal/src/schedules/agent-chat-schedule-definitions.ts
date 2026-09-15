import { ScheduleOverlapPolicy } from "@temporalio/client";
import {
  AgentChatScheduleInputSchema,
  AGENT_CHAT_DISPATCH_WORKFLOW_TIMEOUT_MS,
  type AgentChatScheduleInput,
} from "#shared/agent/agent-chat.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  schedulesInNamespace,
  type ScheduleDefinition,
  type ScheduleSourceDefinition,
} from "./schedule-types.ts";

// Recurring chats are source-owned so schedule reconciliation can update them
// and detect removed definitions. Add durable chat use cases here rather than
// creating untracked recurring schedules through an ingress API.
const AGENT_CHAT_SCHEDULE_INPUTS: readonly AgentChatScheduleInput[] = [];

export function createAgentChatScheduleDefinition(
  rawInput: AgentChatScheduleInput,
): ScheduleSourceDefinition {
  const input = AgentChatScheduleInputSchema.parse(rawInput);
  if (
    input.config.origin.kind !== "schedule" ||
    input.config.origin.scheduleId !== input.scheduleId
  ) {
    throw new Error("Agent chat config origin must match the schedule id");
  }
  return {
    id: input.scheduleId,
    workflowType: "scheduledAgentChatTurnWorkflow",
    args: [
      {
        config: input.config,
        prompt: input.prompt,
        scheduleId: input.scheduleId,
      },
    ],
    timing:
      input.timing.kind === "cron"
        ? input.timing
        : {
            kind: "interval",
            every: input.timing.every,
            ...(input.timing.offset === undefined
              ? {}
              : { offset: input.timing.offset }),
          },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: AGENT_CHAT_DISPATCH_WORKFLOW_TIMEOUT_MS,
    memo: `Continue durable agent chat: ${input.config.title}`,
  };
}

export const AGENT_CHAT_SCHEDULES: ScheduleDefinition[] = schedulesInNamespace(
  "prod",
  AGENT_CHAT_SCHEDULE_INPUTS.map((input) =>
    createAgentChatScheduleDefinition(input),
  ),
);
