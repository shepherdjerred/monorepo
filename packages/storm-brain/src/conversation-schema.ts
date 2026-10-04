import { z } from "zod";
import contract from "#contracts/companion-chat.json";

const ContractSchema = z.strictObject({
  version: z.literal(1),
  identities: z.array(z.string()).length(3),
  maxPersonalityChars: z.number().int().positive(),
  maxMessageChars: z.number().int().positive(),
  maxContextChars: z.number().int().positive(),
  maxReplyChars: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  monthlyBudgetMicroUsd: z.number().int().positive(),
  timeZone: z.string(),
  requestFields: z.array(z.string()),
  responseFields: z.array(z.string()),
});
export const conversationContract = ContractSchema.parse(contract);
export const ConversationRequestSchema = z.strictObject({
  requestId: z.uuid(),
  identity: z
    .string()
    .refine((value) => conversationContract.identities.includes(value)),
  personality: z.string().min(1).max(conversationContract.maxPersonalityChars),
  message: z.string().min(1).max(conversationContract.maxMessageChars),
  context: z.string().max(conversationContract.maxContextChars),
});
export const ConversationTextSchema = z.strictObject({
  text: z.string().trim().min(1).max(conversationContract.maxReplyChars),
});
export const ConversationResponseSchema = ConversationTextSchema.extend({
  model: z.string().min(1),
  costMicros: z.number().int().nonnegative(),
});
if (
  Object.keys(ConversationRequestSchema.shape).join(",") !==
    conversationContract.requestFields.join(",") ||
  Object.keys(ConversationResponseSchema.shape).join(",") !==
    conversationContract.responseFields.join(",")
)
  throw new Error("companion wire fields differ from shared contract");
export type ConversationRequest = z.infer<typeof ConversationRequestSchema>;
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
