import { createHash } from "node:crypto";
import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "#integrations/http.ts";
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
    if (config.mail === undefined)
      throw new IntegrationError("mail", "interaction-required");
    const receiptId = input.receipt;
    if (!/^[\w-]{1,128}$/u.test(receiptId))
      return { status: "unknown", recipient: null };
    const response = await request(
      transport ?? fetch,
      "mail",
      endpoint(
        config.mail.baseUrl,
        `v1/messages/${encodeURIComponent(receiptId)}`,
      ),
      {
        method: "GET",
        acceptedStatuses: [404],
        headers: {
          Authorization: `Bearer ${config.mail.token}`,
        },
      },
    );
    if (response.status === 404) return { status: "unknown", recipient: null };
    const message = z
      .object({
        id: z.string().min(1),
        status: z.enum(["queued", "sending", "retrying", "sent", "failed"]),
        recipients: z.array(z.email()),
        tag: z.string().nullable(),
      })
      .parse(await json(response, "mail"));
    if (
      message.id !== receiptId ||
      message.tag !== `media-${input.idempotencyKey}` ||
      message.recipients.length !== 1
    )
      return { status: "unknown", recipient: null };
    const status =
      message.status === "sent"
        ? "delivered"
        : message.status === "failed"
          ? "bounced"
          : "accepted";
    return { status, recipient: message.recipients[0] ?? null };
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
