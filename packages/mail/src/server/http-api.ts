import { Hono } from "hono";
import { MailboxAddressSchema } from "@shepherdjerred/ops-model/email/mailbox.ts";
import {
  SendMessageRequestSchema,
  type SendMessageRequest,
  type SendMessageResponse,
} from "@shepherdjerred/mail/shared/contract.ts";
import {
  authenticateBearerClient,
  isSenderDomainAllowed,
  type AuthenticatedMailClient,
  type MailClientsMap,
} from "./auth.ts";
import type { MailSettings } from "./config.ts";
import type { MailMetrics } from "./metrics.ts";
import { synthesizeMimeMessage } from "./mime.ts";
import { MAX_SMTP_MESSAGE_BYTES } from "./smtp-protocol.ts";
import type { MailStore } from "./store.ts";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const MAX_HTTP_BODY_BYTES = 26 * 1024 * 1024;

export type HttpApiDependencies = {
  readonly store: MailStore;
  readonly clients: MailClientsMap;
  readonly getSettings: () => Promise<MailSettings>;
  readonly onMessageQueued: () => void;
  readonly metrics?: MailMetrics;
  readonly now?: () => Date;
};

type JsonBodyReadResult =
  | { readonly kind: "ok"; readonly parsed: unknown }
  | { readonly kind: "too_large" }
  | { readonly kind: "invalid_json" };

async function readBoundedJsonPayload(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyReadResult> {
  const declaredBytes = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    return { kind: "too_large" };
  }
  if (request.body === null) {
    return { kind: "invalid_json" };
  }
  const byteChunks: Uint8Array[] = [];
  let accumulatedBytes = 0;
  const streamReader = request.body.getReader();
  try {
    let chunk = await streamReader.read();
    while (!chunk.done) {
      accumulatedBytes += chunk.value.byteLength;
      if (accumulatedBytes > maxBytes) {
        await streamReader.cancel();
        return { kind: "too_large" };
      }
      byteChunks.push(chunk.value);
      chunk = await streamReader.read();
    }
  } finally {
    streamReader.releaseLock();
  }
  try {
    const bodyString = Buffer.concat(byteChunks, accumulatedBytes).toString(
      "utf8",
    );
    return { kind: "ok", parsed: JSON.parse(bodyString) as unknown };
  } catch {
    return { kind: "invalid_json" };
  }
}

type ValidatedSendPayload =
  | { readonly kind: "ok"; readonly data: SendMessageRequest }
  | {
      readonly kind: "error";
      readonly status: 400 | 403;
      readonly body: Record<string, unknown>;
    };

async function parseAndValidateSendPayload(
  request: Request,
  authenticated: AuthenticatedMailClient,
): Promise<ValidatedSendPayload> {
  const payloadResult = await readBoundedJsonPayload(
    request,
    MAX_HTTP_BODY_BYTES,
  );
  if (payloadResult.kind === "too_large") {
    return {
      kind: "error",
      status: 400,
      body: { error: "Request payload exceeds maximum size" },
    };
  }
  if (payloadResult.kind === "invalid_json") {
    return {
      kind: "error",
      status: 400,
      body: { error: "Request body must be valid JSON" },
    };
  }

  const parsedBody = SendMessageRequestSchema.safeParse(payloadResult.parsed);
  if (!parsedBody.success) {
    return {
      kind: "error",
      status: 400,
      body: {
        error: "Invalid message request",
        issues: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    };
  }

  const data = parsedBody.data;
  const fromValidation = MailboxAddressSchema.safeParse(data.from);
  if (!fromValidation.success) {
    return {
      kind: "error",
      status: 400,
      body: { error: "Invalid sender mailbox address" },
    };
  }
  for (const recipient of data.to) {
    if (!MailboxAddressSchema.safeParse(recipient).success) {
      return {
        kind: "error",
        status: 400,
        body: { error: `Invalid recipient mailbox address: ${recipient}` },
      };
    }
  }

  if (!isSenderDomainAllowed(fromValidation.data, authenticated.config)) {
    return {
      kind: "error",
      status: 403,
      body: { error: "Sender domain is not authorized for this client" },
    };
  }

  return { kind: "ok", data };
}

export function createHttpApiApp(deps: HttpApiDependencies): Hono {
  const app = new Hono();
  const nowFn = deps.now ?? (() => new Date());

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        level: "error",
        service: "mail",
        surface: "http-api",
        path: c.req.path,
        error: error.message,
      }),
    );
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/healthz", (c) => c.text("ok", 200));

  app.post("/v1/messages", async (c) => {
    const authenticated = authenticateBearerClient(
      c.req.header("authorization"),
      deps.clients,
    );
    if (authenticated === null) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const validated = await parseAndValidateSendPayload(
      c.req.raw,
      authenticated,
    );
    if (validated.kind === "error") {
      return c.json(validated.body, validated.status);
    }
    const { data } = validated;

    if (data.idempotencyKey !== undefined) {
      const existing = deps.store.findByIdempotencyKey(
        authenticated.clientId,
        data.idempotencyKey,
      );
      if (existing !== null) {
        deps.metrics?.messagesIngestedTotal.inc({
          protocol: "http",
          client_id: authenticated.clientId,
          deduplicated: "true",
        });
        const response: SendMessageResponse = {
          id: existing.id,
          rfcMessageId: existing.rfcMessageId,
          status: existing.status,
          deduplicated: true,
        };
        return c.json(response, 200);
      }
    }

    const settings = await deps.getSettings();
    const now = nowFn();
    const sinceIso = new Date(now.getTime() - TEN_MINUTES_MS).toISOString();
    if (
      deps.store.countClientMessagesSince(authenticated.clientId, sinceIso) >=
      settings.maxPerClientPerTenMinutes
    ) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    let synthesized;
    try {
      synthesized = await synthesizeMimeMessage(data);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid MIME content",
        },
        400,
      );
    }

    if (synthesized.rawMime.byteLength > MAX_SMTP_MESSAGE_BYTES) {
      return c.json(
        { error: "Synthesized MIME exceeds 25 MiB maximum size" },
        400,
      );
    }

    const enqueued = deps.store.enqueueMessage({
      clientId: authenticated.clientId,
      protocol: "http",
      idempotencyKey: data.idempotencyKey ?? null,
      rfcMessageId: synthesized.rfcMessageId,
      mailFrom: synthesized.mailFrom,
      recipients: synthesized.recipients,
      fromHeader: synthesized.fromHeader,
      toHeader: synthesized.toHeader,
      subject: synthesized.subject,
      tag: data.tag ?? null,
      plainBody: synthesized.plainBody,
      htmlBody: synthesized.htmlBody,
      headers: synthesized.headers,
      rawMime: synthesized.rawMime,
      nowIso: now.toISOString(),
      retentionDays: settings.retentionDays,
    });

    deps.metrics?.messagesIngestedTotal.inc({
      protocol: "http",
      client_id: authenticated.clientId,
      deduplicated: enqueued.deduplicated ? "true" : "false",
    });

    if (!enqueued.deduplicated) {
      deps.onMessageQueued();
    }

    const response: SendMessageResponse = {
      id: enqueued.message.id,
      rfcMessageId: enqueued.message.rfcMessageId,
      status: enqueued.message.status,
      deduplicated: enqueued.deduplicated,
    };
    return c.json(response, enqueued.deduplicated ? 200 : 202);
  });

  app.get("/v1/messages/:id", (c) => {
    const authenticated = authenticateBearerClient(
      c.req.header("authorization"),
      deps.clients,
    );
    if (authenticated === null) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const receipt = deps.store.getReceipt(
      authenticated.clientId,
      c.req.param("id"),
    );
    return receipt === null
      ? c.json({ error: "Message not found" }, 404)
      : c.json(receipt, 200);
  });

  app.all("*", (c) => c.json({ error: "Not found" }, 404));

  return app;
}
