import { createHash } from "node:crypto";
import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "#integrations/http.ts";
import { postalHttp } from "#integrations/postal-http.ts";
import type { NotificationTransportConfig } from "#integrations/notification-transport.ts";

export type ReceiptQuery = {
  channel: "email" | "discord" | "discord_shared";
  receipt: string;
  idempotencyKey: string;
};
export type ReceiptObservation = {
  status: "accepted" | "delivered" | "bounced" | "unknown";
  recipient: string | null;
};

/** Bounded receipt lookup only; never search arbitrary mail or retry a send. */
export function createNotificationReceiptReader(
  config: NotificationTransportConfig,
  transport?: FetchTransport,
): (input: ReceiptQuery) => Promise<ReceiptObservation> {
  return async (input) => {
    if (input.channel !== "email")
      return discordReceipt(config, input, transport ?? fetch);
    if (config.postal === undefined)
      throw new IntegrationError("postal", "interaction-required");
    const match = /^(?:[^\s:]{1,900}:)?([1-9]\d{0,14})$/u.exec(input.receipt);
    if (match?.[1] === undefined)
      throw new IntegrationError("postal", "invalid-response");
    const envelope = z.object({ status: z.string(), data: z.unknown() }).parse(
      await json(
        await request(
          transport ?? postalHttp,
          "postal",
          endpoint(config.postal.baseUrl, "api/v1/messages/message"),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Server-API-Key": config.postal.apiKey,
              ...(config.postal.hostHeader === undefined
                ? {}
                : { Host: config.postal.hostHeader }),
            },
            body: JSON.stringify({
              id: Number(match[1]),
              _expansions: ["status", "details"],
            }),
          },
        ),
        "postal",
      ),
    );
    if (envelope.status !== "success")
      return { status: "unknown", recipient: null };
    const message = z
      .object({
        id: z.number().int(),
        status: z.object({ status: z.string(), held: z.boolean() }),
        details: z.object({
          rcpt_to: z.email(),
          tag: z.string().nullable(),
          direction: z.string(),
          bounce: z.boolean(),
        }),
      })
      .parse(envelope.data);
    if (
      message.id !== Number(match[1]) ||
      message.details.tag !== `media-${input.idempotencyKey}` ||
      message.details.direction !== "outgoing"
    )
      return { status: "unknown", recipient: null };
    const status =
      message.details.bounce ||
      ["Bounced", "HardFail"].includes(message.status.status)
        ? "bounced"
        : message.status.status === "Sent"
          ? "delivered"
          : ["Pending", "Held", "SoftFail"].includes(message.status.status)
            ? "accepted"
            : "unknown";
    return { status, recipient: message.details.rcpt_to };
  };
}

async function discordReceipt(
  config: NotificationTransportConfig,
  input: ReceiptQuery,
  transport: FetchTransport,
): Promise<ReceiptObservation> {
  if (config.discord === undefined)
    throw new IntegrationError("discord", "interaction-required");
  const match = /^discord:(\d{1,25}):(\d{1,25})$/u.exec(input.receipt);
  const channelId = match?.[1];
  const messageId = match?.[2];
  if (channelId === undefined || messageId === undefined)
    throw new IntegrationError("discord", "invalid-response");
  const headers = { Authorization: `Bot ${config.discord.botToken}` };
  const identity = z
    .object({ id: z.string(), bot: z.literal(true) })
    .parse(
      await json(
        await request(
          transport,
          "discord",
          endpoint("https://discord.com/api/v10", "users/@me"),
          { method: "GET", headers },
        ),
        "discord",
      ),
    );
  const channel = z
    .object({
      id: z.string(),
      type: z.number().int(),
      recipients: z.array(z.object({ id: z.string() })).optional(),
    })
    .parse(
      await json(
        await request(
          transport,
          "discord",
          endpoint("https://discord.com/api/v10", `channels/${channelId}`),
          { method: "GET", headers },
        ),
        "discord",
      ),
    );
  const message = z
    .object({
      id: z.string(),
      channel_id: z.string(),
      nonce: z.union([z.string(), z.number()]).nullable().optional(),
      author: z.object({ id: z.string(), bot: z.boolean().optional() }),
    })
    .parse(
      await json(
        await request(
          transport,
          "discord",
          endpoint(
            "https://discord.com/api/v10",
            `channels/${channelId}/messages/${messageId}`,
          ),
          { method: "GET", headers },
        ),
        "discord",
      ),
    );
  const nonce = createHash("sha256")
    .update(input.idempotencyKey)
    .digest("hex")
    .slice(0, 24);
  if (
    channel.id !== channelId ||
    message.id !== messageId ||
    message.channel_id !== channelId ||
    message.author.bot !== true ||
    message.author.id !== identity.id ||
    message.nonce !== nonce
  )
    return { status: "unknown", recipient: null };
  if (input.channel === "discord_shared")
    return { status: "accepted", recipient: channelId };
  return channel.type === 1 && channel.recipients?.length === 1
    ? { status: "accepted", recipient: channel.recipients[0]?.id ?? null }
    : { status: "unknown", recipient: null };
}
