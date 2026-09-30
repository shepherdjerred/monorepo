import { defineQuery, defineUpdate } from "@temporalio/workflow";
import { z } from "zod/v4";
import {
  AgentChatConfigSchema,
  AgentChatTurnRequestSchema,
  AgentChatTurnResultSchema,
  type AgentChatTurnResult,
} from "./agent-chat.ts";

export const AgentChatReceiptInputSchema = z.strictObject({
  config: AgentChatConfigSchema,
  request: AgentChatTurnRequestSchema,
});
export type AgentChatReceiptInput = z.infer<typeof AgentChatReceiptInputSchema>;
export const AgentChatPinnedTurnSchema = AgentChatReceiptInputSchema.extend({
  runId: z.uuid(),
});
export type AgentChatPinnedTurn = z.infer<typeof AgentChatPinnedTurnSchema>;
export const AgentChatPinnedResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    result: AgentChatTurnResultSchema,
  }),
  z.strictObject({ status: z.literal("run-closed") }),
]);
export type AgentChatPinnedResult = z.infer<typeof AgentChatPinnedResultSchema>;
export type AgentChatReceiptActivities = {
  locateAgentChatRun: (input: AgentChatReceiptInput) => Promise<string>;
  dispatchPinnedAgentChatTurn: (
    input: AgentChatPinnedTurn,
  ) => Promise<AgentChatPinnedResult>;
};
export const getAgentChatReceiptInputQuery = defineQuery<AgentChatReceiptInput>(
  "getAgentChatReceiptInput",
);
export const awaitAgentChatReceiptUpdate = defineUpdate<AgentChatTurnResult>(
  "awaitAgentChatReceipt",
);
