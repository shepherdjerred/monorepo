import { expect, test } from "vitest";
import { ScheduleOverlapPolicy } from "@temporalio/client";
import {
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_DISPATCH_MAX_ATTEMPTS,
  AGENT_CHAT_DISPATCH_WORKFLOW_TIMEOUT_MS,
  AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS,
  AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS,
  AGENT_CHAT_RECEIPT_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_RECEIPT_WORKFLOW_TIMEOUT_MS,
  AGENT_CHAT_SCHEDULE_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS,
  AGENT_CHAT_SETTLEMENT_MARGIN_MS,
  AGENT_CHAT_TURN_TIMEOUT_MS,
  MAX_AGENT_CHAT_PENDING_TURNS,
  type AgentChatScheduleInput,
} from "#shared/agent/agent-chat.ts";
import { createAgentChatScheduleDefinition } from "./agent-chat-schedule-definitions.ts";

const INPUT: AgentChatScheduleInput = {
  scheduleId: "agent-chat-test",
  config: {
    chatId: "scheduled-chat",
    title: "Scheduled chat",
    provider: "claude",
    model: "claude-opus-5",
    createdAt: "2026-09-14T20:00:00.000Z",
    origin: { kind: "schedule", scheduleId: "agent-chat-test" },
    maxTurnsPerMessage: 8,
  },
  prompt: "Continue the chat",
  timing: { kind: "interval", every: 86_400_000 },
};

test("schedule timeout covers every admitted dispatch attempt", () => {
  const schedule = createAgentChatScheduleDefinition(INPUT);
  expect(schedule.workflowExecutionTimeout).toBe(
    AGENT_CHAT_DISPATCH_WORKFLOW_TIMEOUT_MS,
  );
  expect(AGENT_CHAT_DISPATCH_WORKFLOW_TIMEOUT_MS).toBeGreaterThan(
    AGENT_CHAT_DISPATCH_MAX_ATTEMPTS * AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  );
  expect(AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS).toBe(
    AGENT_CHAT_TURN_TIMEOUT_MS + AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS,
  );
  expect(AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS).toBe(
    MAX_AGENT_CHAT_PENDING_TURNS *
      AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS +
      AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS,
  );
  expect(AGENT_CHAT_DISPATCH_WORKFLOW_TIMEOUT_MS).toBeGreaterThan(
    AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS,
  );
  expect(AGENT_CHAT_RECEIPT_ADMISSION_TIMEOUT_MS).toBe(
    AGENT_CHAT_RECEIPT_WORKFLOW_TIMEOUT_MS -
      AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS -
      AGENT_CHAT_SETTLEMENT_MARGIN_MS,
  );
  expect(AGENT_CHAT_SCHEDULE_ADMISSION_TIMEOUT_MS).toBe(
    AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS -
      AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS -
      AGENT_CHAT_SETTLEMENT_MARGIN_MS,
  );
  expect(schedule.overlap).toBe(ScheduleOverlapPolicy.SKIP);
});

test("rejects schedule/chat ownership mismatch", () => {
  expect(() =>
    createAgentChatScheduleDefinition({ ...INPUT, scheduleId: "another" }),
  ).toThrow("origin must match");
});
