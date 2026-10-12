import { defineQuery, defineUpdate } from "@temporalio/workflow";
import { z } from "zod/v4";
import type { PreparedImessageCommandSchema } from "./agent-chat-imessage.ts";
import { ImessageCommandSchema } from "./agent-chat-imessage.ts";

export const MAX_PHOTON_PENDING_COMMANDS = 50;
export const MAX_PHOTON_STATE_BYTES = 500_000;
export const PHOTON_RECENT_COMMANDS = 100;
export const PHOTON_ROLLOVER_COMMANDS = 100;

export const PhotonMessageSchema = z.strictObject({
  messageId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200),
  submittedAt: z.iso.datetime(),
  fingerprint: z.string().regex(/^[a-f\d]{64}$/),
  spaceId: z.string().min(1).max(512),
  senderId: z.string().min(1).max(200),
  linePhone: z.string().min(1).max(200),
  action: ImessageCommandSchema.shape.action,
});
export type PhotonMessage = z.infer<typeof PhotonMessageSchema>;
export const PhotonCommandSchema = PhotonMessageSchema.extend({
  sourceSequence: z.number().int().positive(),
  sourceEpoch: z.literal(1),
  outOfOrder: z.boolean(),
});
export type PhotonCommand = z.infer<typeof PhotonCommandSchema>;
export const PhotonConversationStateSchema = z.strictObject({
  conversationId: z.string().min(1).max(200),
  nextSequence: z.number().int().positive().default(1),
  latestTimestamp: z.iso.datetime().optional(),
  pending: z
    .array(PhotonCommandSchema)
    .max(MAX_PHOTON_PENDING_COMMANDS)
    .default([]),
  recent: z
    .array(
      z.strictObject({
        messageId: z.string().min(1).max(200),
        fingerprint: z.string().regex(/^[a-f\d]{64}$/),
      }),
    )
    .max(PHOTON_RECENT_COMMANDS)
    .default([]),
});
export type PhotonConversationState = z.infer<
  typeof PhotonConversationStateSchema
>;
export type PhotonAdmission = {
  status: "accepted" | "duplicate";
  pending: number;
};
export const admitPhotonMessageUpdate = defineUpdate<
  PhotonAdmission,
  [PhotonMessage]
>("admitPhotonMessage");
export const photonConversationStateQuery =
  defineQuery<PhotonConversationState>("photonConversationState");
export const photonCommandInputQuery =
  defineQuery<PhotonCommand>("photonCommandInput");
export type PhotonDelivery = Pick<
  PhotonMessage,
  "messageId" | "spaceId" | "senderId" | "linePhone"
> & { content: string };
export type PhotonActivities = {
  preparePhotonCommand: (
    command: PhotonCommand,
  ) => Promise<z.infer<typeof PreparedImessageCommandSchema>>;
  deliverPhotonResponse: (
    response: PhotonDelivery,
  ) => Promise<{ messageId: string }>;
  waitForPhotonCommand: (
    workflowId: string,
    message: PhotonMessage,
  ) => Promise<void>;
};

export function photonConversationWorkflowId(conversationId: string): string {
  return `agent-chat-photon/${conversationId}`;
}
export function photonCommandWorkflowId(messageId: string): string {
  return `agent-chat-photon-command/${messageId}`;
}
