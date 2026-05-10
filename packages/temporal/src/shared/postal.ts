import { z } from "zod/v4";

const PostalEnvelopeSchema = z.object({
  status: z.string(),
  data: z.unknown(),
});

const PostalSuccessDataSchema = z.object({
  message_id: z.string(),
  messages: z.record(
    z.string(),
    z.object({
      id: z.number(),
      token: z.string(),
    }),
  ),
});

export type PostalConfig = {
  host: string;
  apiKey: string;
  hostHeader?: string;
};

export type PostalSendInput = {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  tag: string;
};

export type PostalSendResult = {
  messageId: string;
  recipientId: number | "unknown";
  subject: string;
  tag: string;
};

/**
 * Resolve `POSTAL_HOST`, `POSTAL_API_KEY`, and the optional
 * `POSTAL_HOST_HEADER` from the environment. Throws when either of the
 * required vars is unset — both are required for any email-sending activity.
 */
export function readPostalConfigFromEnv(): PostalConfig {
  const host = Bun.env["POSTAL_HOST"];
  const apiKey = Bun.env["POSTAL_API_KEY"];
  if (host === undefined || apiKey === undefined) {
    throw new Error("Missing email configuration: POSTAL_HOST, POSTAL_API_KEY");
  }
  const hostHeader = Bun.env["POSTAL_HOST_HEADER"];
  return hostHeader === undefined
    ? { host, apiKey }
    : { host, apiKey, hostHeader };
}

/**
 * Send an email via the homelab's self-hosted Postal API.
 *
 * Postal returns HTTP 200 even on parameter / validation errors — the real
 * outcome is in the JSON envelope's `status` field. Any value other than
 * `"success"` is treated as a failure so callers (and Temporal retry
 * policies) see real-world delivery problems instead of silent drops.
 *
 * Config is injected (defaults to env-resolved) so tests can drive the
 * function without mutating process state.
 */
export async function sendPostalEmail(
  input: PostalSendInput,
  config: PostalConfig = readPostalConfigFromEnv(),
): Promise<PostalSendResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Server-API-Key": config.apiKey,
  };
  // The Fetch spec lists `Host` as a forbidden request header (the runtime is
  // supposed to compute it from the URL). Bun's `fetch` deviates from the spec
  // here and DOES preserve a caller-supplied `Host`, which we depend on:
  // POSTAL_HOST_HEADER is how we route through the Cloudflare Tunnel front to
  // the in-cluster Postal service when its public hostname differs from the
  // upstream. Verified with a local Bun.serve echo test against this exact
  // pattern. If we ever migrate this off Bun, rewrite the URL hostname instead.
  if (config.hostHeader !== undefined) {
    headers["Host"] = config.hostHeader;
  }

  const response = await fetch(`${config.host}/api/v1/send/message`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      to: [input.to],
      from: input.from,
      subject: input.subject,
      html_body: input.htmlBody,
      tag: input.tag,
    }),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Postal API error (${String(response.status)}): ${responseBody}`,
    );
  }

  const envelope = PostalEnvelopeSchema.parse(JSON.parse(responseBody));
  if (envelope.status !== "success") {
    throw new Error(
      `Postal rejected message (status=${envelope.status}): ${responseBody}`,
    );
  }

  const successData = PostalSuccessDataSchema.parse(envelope.data);
  const recipientId = successData.messages[input.to]?.id ?? "unknown";

  return {
    messageId: successData.message_id,
    recipientId,
    subject: input.subject,
    tag: input.tag,
  };
}

/**
 * Resolve recipient + sender addresses from the standard Postal env vars.
 * Throws if either is unset — both are required for any email-sending
 * activity in this worker.
 */
export function resolvePostalAddresses(): {
  recipient: string;
  sender: string;
} {
  const recipient = Bun.env["RECIPIENT_EMAIL"];
  const sender = Bun.env["SENDER_EMAIL"];
  if (recipient === undefined || sender === undefined) {
    throw new Error(
      "Missing email configuration: RECIPIENT_EMAIL, SENDER_EMAIL",
    );
  }
  return { recipient, sender };
}
