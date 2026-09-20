import { z } from "zod/v4";
import {
  AgentChatBindingSchema,
  AgentChatIdSchema,
  AgentChatPromptSchema,
  AgentChatProviderSchema,
  AgentChatSourceSequenceSchema,
} from "#shared/agent/agent-chat.ts";
import { HttpAgentChatTurnIdSchema } from "#shared/agent/agent-chat-http.ts";

export const CreateAgentChatSchema = z
  .strictObject({
    chatId: AgentChatIdSchema.optional(),
    title: z.string().min(1).max(200),
    provider: AgentChatProviderSchema,
    model: z.string().min(1).max(200),
    source: AgentChatBindingSchema,
    prompt: AgentChatPromptSchema.optional(),
    turnId: HttpAgentChatTurnIdSchema.optional(),
    submittedAt: z.iso.datetime({ offset: true }).optional(),
    sourceSequence: AgentChatSourceSequenceSchema,
    maxTurnsPerMessage: z.number().int().positive().max(100).default(24),
  })
  .refine((input) => input.prompt === undefined || input.turnId !== undefined, {
    message: "turnId is required when prompt is present",
    path: ["turnId"],
  })
  .refine(
    (input) => input.prompt === undefined || input.submittedAt !== undefined,
    {
      message: "submittedAt is required when prompt is present",
      path: ["submittedAt"],
    },
  )
  .refine((input) => input.prompt !== undefined || input.chatId !== undefined, {
    message: "chatId is required when prompt is absent",
    path: ["chatId"],
  });

export const ContinueAgentChatSchema = z.strictObject({
  source: AgentChatBindingSchema,
  prompt: AgentChatPromptSchema,
  chatId: AgentChatIdSchema.optional(),
  turnId: HttpAgentChatTurnIdSchema,
  submittedAt: z.iso.datetime({ offset: true }),
  sourceSequence: AgentChatSourceSequenceSchema,
});
export type ContinueAgentChatInput = z.infer<typeof ContinueAgentChatSchema>;

export const BindAgentChatSchema = z.strictObject({
  binding: AgentChatBindingSchema,
  bindingId: HttpAgentChatTurnIdSchema,
  submittedAt: z.iso.datetime({ offset: true }),
  sourceSequence: AgentChatSourceSequenceSchema,
});
