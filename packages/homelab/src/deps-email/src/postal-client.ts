import { z } from "zod";

// Postal API request type for sending messages
type PostalSendMessage = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from: string;
  sender?: string;
  subject: string;
  tag?: string;
  reply_to?: string;
  plain_body?: string;
  html_body?: string;
  attachments?: {
    name: string;
    content_type: string;
    data: string; // Base64 encoded
  }[];
  headers?: Record<string, string>;
  bounce?: boolean;
};

// Postal API response schema
const PostalResponseSchema = z.object({
  status: z.enum(["success", "error"]),
  time: z.number().optional(),
  flags: z.record(z.string(), z.boolean()).optional(),
  data: z
    .object({
      message_id: z.string().optional(),
      messages: z
        .record(
          z.string(),
          z.object({
            id: z.number(),
            token: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),
  error: z.string().optional(),
});

type PostalResponse = z.infer<typeof PostalResponseSchema>;

export type PostalClientConfig = {
  host: string; // e.g., "postal.tailnet-1a49.ts.net" or "http://postal-service:5000"
  apiKey: string; // Server API key from Postal web UI
  defaultFrom?: string;
  /**
   * Override the Host header sent to Postal.
   * Useful when accessing Postal via internal service URL but Postal expects a specific hostname.
   */
  hostHeader?: string;
};

export class PostalClient {
  private baseUrl: string;
  private apiKey: string;
  private defaultFrom: string;
  private hostHeader?: string;

  constructor(config: PostalClientConfig) {
    // Handle both full URLs (http://...) and bare hostnames
    this.baseUrl =
      config.host.startsWith("http://") || config.host.startsWith("https://") ? config.host : `https://${config.host}`;
    this.apiKey = config.apiKey;
    this.defaultFrom = config.defaultFrom ?? "updates@homelab.local";
    this.hostHeader = config.hostHeader;
  }

  async sendEmail(params: {
    to: string | string[];
    subject: string;
    htmlBody: string;
    plainBody?: string;
    from?: string;
    tag?: string;
  }): Promise<PostalResponse> {
    const recipientsParsed = z.array(z.string()).safeParse(params.to);
    const singleRecipientParsed = z.string().safeParse(params.to);
    const recipients = recipientsParsed.success
      ? recipientsParsed.data
      : singleRecipientParsed.success
        ? [singleRecipientParsed.data]
        : [];

    const payload: PostalSendMessage = {
      to: recipients,
      from: params.from ?? this.defaultFrom,
      subject: params.subject,
      html_body: params.htmlBody,
      plain_body: params.plainBody,
      tag: params.tag,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Server-API-Key": this.apiKey,
    };
    if (this.hostHeader) {
      headers["Host"] = this.hostHeader;
    }

    const response = await fetch(`${this.baseUrl}/api/v1/send/message`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const result: unknown = await response.json();
    const parsed = PostalResponseSchema.safeParse(result);

    if (!parsed.success) {
      throw new Error(`Invalid Postal response: ${JSON.stringify(result)}`);
    }

    if (parsed.data.status === "error") {
      throw new Error(`Postal API error: ${parsed.data.error ?? "Unknown error"}`);
    }

    return parsed.data;
  }
}

/**
 * Create a PostalClient from environment variables
 */
export function createPostalClientFromEnv(): PostalClient {
  const host = Bun.env["POSTAL_HOST"];
  const apiKey = Bun.env["POSTAL_API_KEY"];
  const hostHeader = Bun.env["POSTAL_HOST_HEADER"];

  if (!host) {
    throw new Error("POSTAL_HOST environment variable not set");
  }
  if (!apiKey) {
    throw new Error("POSTAL_API_KEY environment variable not set");
  }

  return new PostalClient({
    host,
    apiKey,
    defaultFrom: Bun.env["SENDER_EMAIL"],
    hostHeader,
  });
}
