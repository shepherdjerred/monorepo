import { Hono } from "hono";
import { serveStatic } from "@hono/bun";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  MESSAGE_STATUSES,
  MessageStatusSchema,
  type AdminRetryResponse,
} from "@shepherdjerred/mail/shared/contract.ts";
import type { MailSettings } from "./config.ts";
import { createMailMetrics, type MailMetrics } from "./metrics.ts";
import type { MailStore } from "./store.ts";

const AdminStatusFilterSchema = z.union([
  MessageStatusSchema,
  z.literal("active"),
  z.literal("all"),
]);

const NonNegativeIntQuerySchema = z
  .string()
  .trim()
  .regex(/^\d+$/u)
  .transform(Number)
  .pipe(z.number().int().nonnegative());

const PositiveIntQuerySchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(200));

const AdminMessagesQuerySchema = z.object({
  status: AdminStatusFilterSchema.optional(),
  clientId: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  limit: PositiveIntQuerySchema.optional(),
  offset: NonNegativeIntQuerySchema.optional(),
});

export type TlsExpirySnapshot = {
  readonly iso: string;
  readonly epochSeconds: number;
};

export type AdminAppDependencies = {
  readonly store: MailStore;
  readonly upstreamHost: string;
  readonly upstreamPort: number;
  readonly smtpListenerPort: number | null;
  readonly isSmtpReady?: () => boolean;
  readonly getSmtpTlsCertExpiry?: () => Promise<TlsExpirySnapshot | null>;
  readonly isRelayEnabled: () => Promise<boolean>;
  readonly getSettings: () => Promise<MailSettings>;
  readonly configuredClientIds?: readonly string[];
  readonly onMessageQueued: () => void;
  readonly metrics?: MailMetrics;
  readonly clientRoot?: string;
  readonly now?: () => Date;
};

function createSpaStaticHandler(
  clientRoot: string,
  cacheControl: string,
  indexPath?: string,
) {
  return serveStatic({
    root: clientRoot,
    ...(indexPath === undefined ? {} : { path: indexPath }),
    onFound(_resolvedPath, context) {
      context.header("Cache-Control", cacheControl);
    },
  });
}

function registerClientSpaRoutes(app: Hono, clientRoot: string): void {
  app.use(
    "/assets/*",
    createSpaStaticHandler(clientRoot, "public, max-age=31536000, immutable"),
  );
  app.all("/assets/*", (c) => c.notFound());
  app.get("*", createSpaStaticHandler(clientRoot, "no-cache", "index.html"));
}

function normalizedQueryValue(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim();
}

export function createAdminApp(deps: AdminAppDependencies): Hono {
  const app = new Hono();
  const metrics = deps.metrics ?? createMailMetrics();
  const nowFn = deps.now ?? (() => new Date());

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        level: "error",
        service: "mail",
        surface: "admin",
        path: c.req.path,
        error: error.message,
      }),
    );
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use("*", secureHeaders());

  app.get("/healthz", (c) => c.text("ok", 200));

  app.get("/readyz", (c) => {
    const dbOk = deps.store.ping();
    const smtpOk = deps.isSmtpReady?.() ?? true;
    return dbOk && smtpOk ? c.text("ok", 200) : c.text("not ready", 503);
  });

  app.get("/metrics", async () => {
    const byStatus = deps.store.statusCounts();
    for (const status of MESSAGE_STATUSES) {
      metrics.outboxMessages.set({ status }, byStatus[status]);
    }

    const enabled = await deps.isRelayEnabled();
    metrics.relayEnabled.set(enabled ? 1 : 0);

    if (deps.getSmtpTlsCertExpiry !== undefined) {
      const tlsExpiry = await deps.getSmtpTlsCertExpiry();
      if (tlsExpiry !== null) {
        metrics.smtpTlsCertExpiryTimestampSeconds.set(tlsExpiry.epochSeconds);
      }
    }

    return new Response(await metrics.register.metrics(), {
      status: 200,
      headers: {
        "Content-Type": metrics.register.contentType,
        "Cache-Control": "no-store",
      },
    });
  });

  app.get("/api/admin/overview", async (c) => {
    const [enabled, settings, tlsExpiry] = await Promise.all([
      deps.isRelayEnabled(),
      deps.getSettings(),
      deps.getSmtpTlsCertExpiry === undefined
        ? Promise.resolve(null)
        : deps.getSmtpTlsCertExpiry(),
    ]);

    const overview = deps.store.getOverview(
      {
        enabled,
        upstreamHost: deps.upstreamHost,
        upstreamPort: deps.upstreamPort,
        smtpListenerPort: deps.smtpListenerPort,
        smtpTlsCertExpiresAt: tlsExpiry?.iso ?? null,
        retentionDays: settings.retentionDays,
      },
      deps.configuredClientIds ?? [],
      nowFn().toISOString(),
    );
    return c.json(overview, 200);
  });

  app.get("/api/admin/messages", (c) => {
    const parsedQuery = AdminMessagesQuerySchema.safeParse({
      status: normalizedQueryValue(c.req.query("status")),
      clientId: normalizedQueryValue(c.req.query("clientId")),
      tag: normalizedQueryValue(c.req.query("tag")),
      q: normalizedQueryValue(c.req.query("q")),
      limit: normalizedQueryValue(c.req.query("limit")),
      offset: normalizedQueryValue(c.req.query("offset")),
    });

    if (!parsedQuery.success) {
      return c.json({ error: "Invalid query parameters" }, 400);
    }

    const result = deps.store.listMessages({
      ...(parsedQuery.data.status === undefined
        ? {}
        : { status: parsedQuery.data.status }),
      ...(parsedQuery.data.clientId === undefined
        ? {}
        : { clientId: parsedQuery.data.clientId }),
      ...(parsedQuery.data.tag === undefined
        ? {}
        : { tag: parsedQuery.data.tag }),
      ...(parsedQuery.data.q === undefined ? {} : { q: parsedQuery.data.q }),
      ...(parsedQuery.data.limit === undefined
        ? {}
        : { limit: parsedQuery.data.limit }),
      ...(parsedQuery.data.offset === undefined
        ? {}
        : { offset: parsedQuery.data.offset }),
    });
    return c.json(result, 200);
  });

  app.get("/api/admin/messages/:id", (c) => {
    const detail = deps.store.getMessageDetail(c.req.param("id"));
    return detail === null
      ? c.json({ error: "Message not found" }, 404)
      : c.json(detail, 200);
  });

  app.post("/api/admin/messages/:id/retry", (c) => {
    const retried = deps.store.retryMessage(
      c.req.param("id"),
      nowFn().toISOString(),
    );
    if (retried.kind === "not_found") {
      return c.json({ error: "Message not found" }, 404);
    }
    if (retried.kind === "invalid_status") {
      return c.json(
        {
          error: `Cannot retry message in '${retried.status}' status`,
        },
        409,
      );
    }

    deps.onMessageQueued();
    const response: AdminRetryResponse = { message: retried.message };
    return c.json(response, 200);
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  if (deps.clientRoot !== undefined) {
    registerClientSpaRoutes(app, deps.clientRoot);
  }

  return app;
}
