import { z } from "zod/v4";
import { AgentChatIdSchema, AgentChatProviderSchema } from "./agent-chat.ts";
import { HttpAgentChatCommandSchema } from "./agent-chat-http.ts";

const PromptSchema = z.string().trim().min(1).max(4000);
export const ImessageActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("new"),
    provider: AgentChatProviderSchema,
    prompt: PromptSchema,
  }),
  z.strictObject({
    kind: z.literal("continue"),
    chatId: AgentChatIdSchema.optional(),
    prompt: PromptSchema,
  }),
  z.strictObject({ kind: z.literal("use"), chatId: AgentChatIdSchema }),
  z.strictObject({ kind: z.literal("list") }),
  z.strictObject({ kind: z.literal("help") }),
]);
export const ImessageCommandSchema = z.strictObject({
  messageId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200),
  submittedAt: z.iso.datetime(),
  action: ImessageActionSchema,
});
export type ImessageCommand = z.infer<typeof ImessageCommandSchema>;
export const BlueBubblesCursorSchema = z.strictObject({
  startedAt: z.iso.datetime(),
  lastRowId: z.number().int().nonnegative(),
});
export type BlueBubblesCursor = z.infer<typeof BlueBubblesCursorSchema>;
export const BlueBubblesPollResultSchema = z.strictObject({
  startedAt: z.iso.datetime(),
  lastRowId: z.number().int().nonnegative(),
  commands: z.array(ImessageCommandSchema).max(50),
});
export const PreparedImessageCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("turn"),
    command: HttpAgentChatCommandSchema,
  }),
  z.strictObject({
    kind: z.literal("message"),
    content: z.string().min(1).max(16_000),
  }),
]);
export type ImessageActivities = {
  pollBlueBubblesMessages: (
    cursor: BlueBubblesCursor,
  ) => Promise<z.infer<typeof BlueBubblesPollResultSchema>>;
  prepareImessageCommand: (
    command: ImessageCommand,
  ) => Promise<z.infer<typeof PreparedImessageCommandSchema>>;
  deliverImessageResponse: (input: {
    conversationId: string;
    messageId: string;
    content: string;
  }) => Promise<void>;
};
