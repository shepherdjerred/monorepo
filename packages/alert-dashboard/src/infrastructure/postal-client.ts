import { z } from "zod";

import type { PostalPort } from "#application/ports";

const PostalEnvelopeSchema = z.object({
  status: z.string(),
  data: z.unknown(),
});
const PostalSuccessSchema = z.object({ message_id: z.string().min(1) });

export type PostalClientOptions = {
  host: string;
  apiKey: string;
  from: string;
  to: string;
  hostHeader?: string;
};

export class PostalClient implements PostalPort {
  readonly #options: PostalClientOptions;

  constructor(options: PostalClientOptions) {
    this.#options = {
      ...options,
      host: z.url().parse(options.host).replace(/\/$/u, ""),
      from: z.email().parse(options.from),
      to: z.email().parse(options.to),
    };
  }

  async send(input: {
    messageId: string;
    subject: string;
    htmlBody: string;
  }): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Server-API-Key": this.#options.apiKey,
    };
    if (this.#options.hostHeader !== undefined)
      headers["Host"] = this.#options.hostHeader;
    const response = await fetch(`${this.#options.host}/api/v1/send/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: [this.#options.to],
        from: this.#options.from,
        subject: input.subject,
        html_body: input.htmlBody,
        message_id: input.messageId,
        tag: "alert-dashboard-opening",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(`Postal returned ${String(response.status)}: ${body}`);
    const envelope = PostalEnvelopeSchema.parse(JSON.parse(body));
    if (envelope.status !== "success") {
      throw new Error(`Postal rejected message with status ${envelope.status}`);
    }
    PostalSuccessSchema.parse(envelope.data);
  }
}

export const disabledPostal: PostalPort = {
  send: () => Promise.reject(new Error("Postal is disabled")),
};
