import { createHash } from "node:crypto";
import { slimEnvelopeSchema } from "@spectrum-ts/core/webhook";
import { z } from "zod/v4";
import { parseImessageAction } from "#lib/imessage-action.ts";
import { validateAgentChatIngressTimestamp } from "#shared/agent/agent-chat-ingress.ts";
import { PhotonMessageSchema } from "#shared/agent/agent-chat-photon.ts";

const TextEnvelopeSchema = z.object({
  space: z.object({
    id: z.string().min(1).max(512),
    platform: z.enum(["imessage", "iMessage"]),
    type: z.literal("dm"),
    phone: z.string().min(1).max(200),
  }),
  message: z.object({
    id: z.string().min(1).max(512),
    platform: z.enum(["imessage", "iMessage"]),
    direction: z.literal("inbound"),
    timestamp: z.iso.datetime(),
    sender: z.object({ id: z.string().min(1).max(200) }),
    space: z.object({
      id: z.string().min(1).max(512),
      type: z.literal("dm"),
      phone: z.string().min(1).max(200),
    }),
    content: z.object({
      type: z.literal("text"),
      text: z.string().max(100_000),
    }),
  }),
});

const digest = (parts: readonly string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export function normalizePhotonMessage(
  value: unknown,
  projectId: string,
  owners: readonly string[],
  now: string,
) {
  if (z.object({ event: z.string() }).parse(value).event !== "messages") return;
  const envelope = slimEnvelopeSchema.parse(value);
  if (
    envelope.event !== "messages" ||
    envelope.message.content.type !== "text" ||
    envelope.message.direction !== "inbound" ||
    !["imessage", "iMessage"].includes(envelope.message.platform ?? "") ||
    envelope.space?.["type"] !== "dm" ||
    envelope.message.sender === undefined ||
    !owners.includes(envelope.message.sender.id)
  )
    return;
  const { space, message } = TextEnvelopeSchema.parse(envelope);
  if (space.id !== message.space.id || space.phone !== message.space.phone)
    throw new TypeError("Photon routing context does not match its message");
  validateAgentChatIngressTimestamp(message.timestamp, now);
  if (message.content.text.trim() === "") return;
  return PhotonMessageSchema.parse({
    messageId: `photon-${digest([projectId, space.id, message.id])}`,
    conversationId: `photon-${digest([projectId, space.id])}`,
    submittedAt: message.timestamp,
    fingerprint: digest([
      projectId,
      space.id,
      space.phone,
      message.id,
      message.sender.id,
      message.timestamp,
      message.content.text,
    ]),
    spaceId: space.id,
    senderId: message.sender.id,
    linePhone: space.phone,
    action: parseImessageAction(message.content.text),
  });
}
