import { createHash } from "node:crypto";
import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import { postalHttp } from "./postal-http.ts";

type Message = {
  channel: "email" | "discord";
  recipient: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};
export type NotificationTransportConfig = {
  postal?: {
    baseUrl: string;
    apiKey: string;
    from: string;
    hostHeader?: string;
  };
  discord?: { botToken: string };
};

export function createNotificationTransport(
  config: NotificationTransportConfig,
  transport?: FetchTransport,
): (message: Message) => Promise<{ receipt: string }> {
  return async (message) => {
    if (message.channel === "email") {
      if (config.postal === undefined)
        throw new IntegrationError("postal", "interaction-required");
      const response = await request(
        transport ?? postalHttp,
        "postal",
        endpoint(config.postal.baseUrl, "api/v1/send/message"),
        {
          method: "POST",
          mutation: true,
          headers: {
            "Content-Type": "application/json",
            "X-Server-API-Key": config.postal.apiKey,
            ...(config.postal.hostHeader === undefined
              ? {}
              : { Host: config.postal.hostHeader }),
          },
          body: JSON.stringify({
            to: [z.email().parse(message.recipient)],
            from: config.postal.from,
            subject: message.subject,
            plain_body: message.text,
            tag: `media-${message.idempotencyKey}`,
          }),
        },
      );
      const envelope = z
        .object({ status: z.string(), data: z.unknown() })
        .parse(await json(response, "postal"));
      if (envelope.status === "error")
        throw new IntegrationError("postal", "interaction-required");
      if (envelope.status !== "success")
        throw new IntegrationError("postal", "outcome-unknown");
      const data = z
        .object({
          message_id: z.string().min(1),
          messages: z.record(z.string(), z.object({ id: z.number().int() })),
        })
        .parse(envelope.data);
      const recipient = data.messages[message.recipient];
      if (recipient === undefined)
        throw new IntegrationError("postal", "outcome-unknown");
      return { receipt: `${data.message_id}:${String(recipient.id)}` };
    }
    if (config.discord === undefined)
      throw new IntegrationError("discord", "interaction-required");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bot ${config.discord.botToken}`,
    };
    const channel = z.object({ id: z.string().regex(/^\d+$/u) }).parse(
      await json(
        await request(
          transport ?? fetch,
          "discord",
          endpoint("https://discord.com/api/v10", "users/@me/channels"),
          {
            method: "POST",
            mutation: true,
            headers,
            body: JSON.stringify({
              recipient_id: z.string().regex(/^\d+$/u).parse(message.recipient),
            }),
          },
        ),
        "discord",
      ),
    );
    // Discord's nonce window is short; the durable database sending journal remains the retry boundary.
    const nonce = createHash("sha256")
      .update(message.idempotencyKey)
      .digest("hex")
      .slice(0, 24);
    const content = `${message.subject}\n${message.text}`;
    if (content.length > 2000)
      throw new IntegrationError("discord", "interaction-required");
    const result = z.object({ id: z.string().regex(/^\d+$/u) }).parse(
      await json(
        await request(
          transport ?? fetch,
          "discord",
          endpoint(
            "https://discord.com/api/v10",
            `channels/${channel.id}/messages`,
          ),
          {
            method: "POST",
            mutation: true,
            headers,
            body: JSON.stringify({
              content,
              nonce,
              enforce_nonce: true,
              allowed_mentions: { parse: [] },
            }),
          },
        ),
        "discord",
      ),
    );
    return { receipt: result.id };
  };
}
