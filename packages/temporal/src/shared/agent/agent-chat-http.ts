import { defineUpdate } from "@temporalio/workflow";
import { z } from "zod/v4";
import {
  AgentChatConfigSchema,
  AgentChatIdSchema,
  AgentChatTurnRequestSchema,
  AgentChatTurnResultSchema,
} from "./agent-chat.ts";

export const HttpAgentChatTurnIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z\d][\w.:-]*$/i);

const HttpAgentChatNewCommandSchema = z.strictObject({
  kind: z.literal("new"),
  config: AgentChatConfigSchema,
  request: AgentChatTurnRequestSchema.extend({
    turnId: HttpAgentChatTurnIdSchema,
  }),
});

const HttpAgentChatContinueCommandSchema = z.strictObject({
  kind: z.literal("continue"),
  chatId: AgentChatIdSchema,
  request: AgentChatTurnRequestSchema.extend({
    turnId: HttpAgentChatTurnIdSchema,
  }),
});

export const HttpAgentChatCommandSchema = z.discriminatedUnion("kind", [
  HttpAgentChatNewCommandSchema,
  HttpAgentChatContinueCommandSchema,
]);
export type HttpAgentChatCommand = z.infer<typeof HttpAgentChatCommandSchema>;

export const HttpAgentChatStartOptionsSchema = z.strictObject({
  waitForActivation: z.boolean(),
});
export type HttpAgentChatStartOptions = z.infer<
  typeof HttpAgentChatStartOptionsSchema
>;

export const activateHttpAgentChatCommandUpdate = defineUpdate<
  null,
  [HttpAgentChatCommand]
>("activateHttpAgentChatCommand");

export const HttpAgentChatActivityInputSchema = z.strictObject({
  command: HttpAgentChatCommandSchema,
  providerStartDeadline: z.iso.datetime({ offset: true }),
});
export type HttpAgentChatActivityInput = z.infer<
  typeof HttpAgentChatActivityInputSchema
>;

function requestIdentity(request: z.infer<typeof AgentChatTurnRequestSchema>) {
  return {
    turnId: request.turnId,
    prompt: request.prompt,
    submittedAt: request.submittedAt,
    source: request.source,
  };
}

export function httpAgentChatCommandIdentity(
  command: HttpAgentChatCommand,
): string {
  return command.kind === "continue"
    ? JSON.stringify({
        kind: command.kind,
        chatId: command.chatId,
        request: requestIdentity(command.request),
      })
    : JSON.stringify({
        kind: command.kind,
        chatId: command.config.chatId,
        title: command.config.title,
        provider: command.config.provider,
        model: command.config.model,
        origin: command.config.origin,
        maxTurnsPerMessage: command.config.maxTurnsPerMessage,
        request: requestIdentity(command.request),
      });
}

export const HttpAgentChatTurnReceiptSchema = z.strictObject({
  status: z.literal("accepted"),
  turnId: HttpAgentChatTurnIdSchema,
  workflowId: z.string().min(1),
});
export type HttpAgentChatTurnReceipt = z.infer<
  typeof HttpAgentChatTurnReceiptSchema
>;

const HttpAgentChatRunningTurnSchema = z.strictObject({
  status: z.literal("running"),
  turnId: HttpAgentChatTurnIdSchema,
  workflowId: z.string().min(1),
});

const HttpAgentChatCompletedTurnSchema = z.strictObject({
  status: z.literal("completed"),
  turnId: HttpAgentChatTurnIdSchema,
  workflowId: z.string().min(1),
  result: AgentChatTurnResultSchema,
});

const HttpAgentChatFailedTurnSchema = z.strictObject({
  status: z.literal("failed"),
  turnId: HttpAgentChatTurnIdSchema,
  workflowId: z.string().min(1),
  temporalStatus: z.string().min(1),
});

export const HttpAgentChatTurnStatusSchema = z.discriminatedUnion("status", [
  HttpAgentChatRunningTurnSchema,
  HttpAgentChatCompletedTurnSchema,
  HttpAgentChatFailedTurnSchema,
]);
export type HttpAgentChatTurnStatus = z.infer<
  typeof HttpAgentChatTurnStatusSchema
>;

export type HttpAgentChatActivities = {
  executeHttpAgentChatCommand: (
    input: HttpAgentChatActivityInput,
  ) => Promise<z.infer<typeof AgentChatTurnResultSchema>>;
};
