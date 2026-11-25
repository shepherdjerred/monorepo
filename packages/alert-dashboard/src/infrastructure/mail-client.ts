import { MailboxAddressSchema } from "@shepherdjerred/ops-model/email/mailbox.ts";
import { z } from "zod";

import type { MailMessage, MailPort } from "#application/ports";

const MailSendResponseSchema = z.object({
  id: z.string().min(1),
  rfcMessageId: z.string().min(1),
  status: z.enum(["queued", "sending", "retrying", "sent", "failed"]),
  deduplicated: z.boolean(),
});

export type MailClientOptions = {
  baseUrl: string;
  token: string;
  from: string;
  to: string;
};

export class MailClient implements MailPort {
  readonly #options: MailClientOptions;

  constructor(options: MailClientOptions) {
    this.#options = {
      baseUrl: z.url().parse(options.baseUrl).replace(/\/+$/u, ""),
      token: z.string().min(1).parse(options.token),
      from: MailboxAddressSchema.parse(options.from),
      to: z.email().parse(options.to),
    };
  }

  async send(input: MailMessage): Promise<void> {
    const response = await fetch(`${this.#options.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#options.token}`,
      },
      body: JSON.stringify({
        to: [this.#options.to],
        from: this.#options.from,
        subject: input.subject,
        htmlBody: input.htmlBody,
        ...(input.plainBody === undefined
          ? {}
          : { plainBody: input.plainBody }),
        idempotencyKey: input.messageId,
        messageId: input.messageId,
        tag: input.tag ?? "alert-dashboard-opening",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Mail API returned ${String(response.status)}: ${body}`);
    }
    MailSendResponseSchema.parse(JSON.parse(body));
  }
}

export const disabledMail: MailPort = {
  send: () => Promise.reject(new Error("Mail is disabled")),
};
