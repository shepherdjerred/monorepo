import { createHash } from "node:crypto";
import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";

type Message = {
  channel: "email" | "discord" | "discord_shared";
  recipient: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};
export type NotificationMutation = { beforeMutation: () => void };
export type NotificationTransportConfig = {
  mail?: {
    baseUrl: string;
    token: string;
    from: string;
  };
  discord?: { botToken: string };
};

export function createNotificationTransport(
  config: NotificationTransportConfig,
  transport?: FetchTransport,
): (
  message: Message,
  mutation?: NotificationMutation,
) => Promise<{ receipt: string }> {
  return async (message, mutation) => {
    if (message.channel === "email") {
      if (config.mail === undefined)
        throw new IntegrationError("mail", "interaction-required");
      mutation?.beforeMutation();
      const response = await request(
        transport ?? fetch,
        "mail",
        endpoint(config.mail.baseUrl, "v1/messages"),
        {
          method: "POST",
          mutation: true,
          acceptedStatuses: [400],
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.mail.token}`,
          },
          body: JSON.stringify({
            to: [z.email().parse(message.recipient)],
            from: config.mail.from,
            subject: message.subject,
            plainBody: message.text,
            tag: `media-${message.idempotencyKey}`,
            idempotencyKey: message.idempotencyKey,
          }),
        },
      );
      if (response.status === 400)
        throw new IntegrationError("mail", "interaction-required", 400);
      const parsed = z
        .object({
          id: z.string().min(1),
          status: z.enum(["queued", "sending", "retrying", "sent", "failed"]),
        })
        .safeParse(await json(response, "mail"));
      if (!parsed.success)
        throw new IntegrationError("mail", "outcome-unknown");
      return { receipt: parsed.data.id };
    }
    if (config.discord === undefined)
      throw new IntegrationError("discord", "interaction-required");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bot ${config.discord.botToken}`,
    };
    mutation?.beforeMutation();
    const channel =
      message.channel === "discord_shared"
        ? {
            id: z
              .string()
              .regex(/^\d{1,25}$/u)
              .parse(message.recipient),
          }
        : z.object({ id: z.string().regex(/^\d+$/u) }).parse(
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
                    recipient_id: z
                      .string()
                      .regex(/^\d+$/u)
                      .parse(message.recipient),
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
    mutation?.beforeMutation();
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
    return { receipt: `discord:${channel.id}:${result.id}` };
  };
}
