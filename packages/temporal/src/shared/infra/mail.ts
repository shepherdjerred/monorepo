import { z } from "zod/v4";

const MailSendResponseSchema = z.object({
  id: z.string().min(1),
  rfcMessageId: z.string().min(1),
  status: z.enum(["queued", "sending", "retrying", "sent", "failed"]),
  deduplicated: z.boolean(),
});

export type MailConfig = {
  baseUrl: string;
  token: string;
};

export type MailSendInput = {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  plainBody?: string;
  headers?: Record<string, string>;
  messageId?: string;
  idempotencyKey?: string;
  tag: string;
  /**
   * Abandons the request. Report delivery uses this so an attempt whose lease
   * can be taken over cannot still have a message in flight.
   */
  signal?: AbortSignal;
};

export type MailSendResult = {
  messageId: string;
  recipientId: number | "unknown";
  subject: string;
  tag: string;
};

/**
 * Resolve `MAIL_API_URL` and `MAIL_API_TOKEN` from the environment.
 * Throws when either required variable is unset or empty.
 */
export function readMailConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): MailConfig {
  const baseUrl = env["MAIL_API_URL"]?.trim();
  const token = env["MAIL_API_TOKEN"]?.trim();
  if (
    baseUrl === undefined ||
    baseUrl === "" ||
    token === undefined ||
    token === ""
  ) {
    throw new Error(
      "Missing email configuration: MAIL_API_URL, MAIL_API_TOKEN",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/u, ""), token };
}

/**
 * Send an email via the first-party `@shepherdjerred/mail` HTTP API.
 *
 * Config is injected (defaults to env-resolved) so tests can drive the
 * function without mutating process state.
 */
export async function sendMailEmail(
  input: MailSendInput,
  config: MailConfig = readMailConfigFromEnv(),
): Promise<MailSendResult> {
  const baseUrl = config.baseUrl.replace(/\/+$/u, "");
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    body: JSON.stringify({
      to: [input.to],
      from: input.from,
      subject: input.subject,
      htmlBody: input.htmlBody,
      ...(input.plainBody === undefined ? {} : { plainBody: input.plainBody }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
      tag: input.tag,
    }),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Mail API error (${String(response.status)}): ${responseBody}`,
    );
  }

  const parsed = MailSendResponseSchema.parse(JSON.parse(responseBody));
  return {
    messageId: parsed.id,
    recipientId: "unknown" as const,
    subject: input.subject,
    tag: input.tag,
  };
}
