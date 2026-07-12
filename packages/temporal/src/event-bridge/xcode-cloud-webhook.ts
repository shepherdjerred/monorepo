import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { ZodError } from "zod/v4";
import {
  type BuildOutcome,
  type XcodeCloudBuildEvent,
  XcodeCloudPayloadSchema,
  classifyBuild,
  normalizeXcodeCloudPayload,
} from "./xcode-cloud-webhook-schema.ts";

const COMPONENT = "xcode-cloud-webhook";
const DEFAULT_PORT = 9468;
// Safety auto-resolve: a fired alert whose build never gets a later SUCCEEDED
// (branch deleted, workflow renamed, etc.) still clears itself after this
// window instead of pinning an incident open forever. A green build resolves
// it sooner. 6h keeps a failure visible across a workday without lingering.
const DEFAULT_ALERT_TTL_SECONDS = 6 * 60 * 60;

export type XcodeCloudWebhookHandle = {
  port: number;
  close: () => Promise<void>;
};

/** One entry of Alertmanager's `POST /api/v2/alerts` array. */
export type AlertmanagerAlert = {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt: string;
  generatorURL?: string;
};

/** Injectable seam: sends the alert array to Alertmanager (or a test double). */
export type AlertPoster = (alerts: AlertmanagerAlert[]) => Promise<void>;

export type XcodeCloudWebhookOptions = {
  /** Firing alerts auto-resolve this long after `startsAt`. */
  ttlMs?: number;
  /** Clock seam so tests get deterministic startsAt/endsAt. */
  now?: () => Date;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...fields,
    }),
  );
}

function tokenMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (presented === undefined) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The real poster. POSTs to Alertmanager's write API. In-cluster the base URL
 * is `http://prometheus-kube-prometheus-alertmanager.prometheus:9093`.
 */
export function createAlertmanagerPoster(baseUrl: string): AlertPoster {
  return async (alerts: AlertmanagerAlert[]): Promise<void> => {
    const url = new URL("/api/v2/alerts", baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alerts),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Alertmanager POST ${url.toString()} failed: ${String(res.status)} ${body}`,
      );
    }
  };
}

/**
 * Build the single Alertmanager alert for a terminal build. Dedup labels
 * ({alertname, service, product, workflow, branch}) deliberately EXCLUDE the
 * build number so a later SUCCEEDED on the same workflow+branch resolves the
 * failure. `severity=warning` matches the existing Alertmanager route to the
 * PagerDuty receiver (packages/homelab .../prometheus.ts), so no routing change
 * is needed. A resolved alert sets endsAt=startsAt so Alertmanager marks it
 * resolved immediately.
 */
export function buildAlert(
  event: XcodeCloudBuildEvent,
  outcome: Exclude<BuildOutcome, "ignore">,
  now: Date,
  ttlMs: number,
): AlertmanagerAlert {
  const labels: Record<string, string> = {
    alertname: "XcodeCloudBuildFailed",
    severity: "warning",
    service: "xcode-cloud",
    product: event.productName,
    workflow: event.workflowName,
    branch: event.branch,
  };

  const summary = `Xcode Cloud build failed: ${event.workflowName} on ${event.branch}`;
  const detailParts = [
    `workflow ${event.workflowName}`,
    `branch ${event.branch}`,
  ];
  if (event.buildNumber !== undefined) {
    detailParts.push(`build #${event.buildNumber}`);
  }
  if (event.completionStatus !== undefined) {
    detailParts.push(`status ${event.completionStatus}`);
  }
  if (event.commitSha !== undefined) {
    detailParts.push(`commit ${event.commitSha.slice(0, 12)}`);
  }
  const message = detailParts.join(", ");

  const startsAt = now.toISOString();
  const endsAt = new Date(
    now.getTime() + (outcome === "resolved" ? 0 : ttlMs),
  ).toISOString();

  const alert: AlertmanagerAlert = {
    labels,
    // `summary` → PagerDuty incident title; `message`/`description` → Custom
    // Details, per the Alertmanager templates in prometheus.ts.
    annotations: { summary, message, description: message },
    startsAt,
    endsAt,
  };
  if (event.buildUrl !== undefined) {
    alert.generatorURL = event.buildUrl;
  }
  return alert;
}

/**
 * Pure Hono app — no port binding — so tests can drive it via `app.fetch()`
 * with an injected `poster`. Mirrors `buildWebhookApp` in github-webhook.ts.
 */
export function buildXcodeCloudWebhookApp(
  token: string,
  poster: AlertPoster,
  options: XcodeCloudWebhookOptions = {},
): Hono {
  const ttlMs = options.ttlMs ?? DEFAULT_ALERT_TTL_SECONDS * 1000;
  const now = options.now ?? ((): Date => new Date());
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok\n"));

  // Xcode Cloud webhooks carry no signature or auth header — the only
  // authenticator available is an unguessable token in the URL path.
  app.post("/hook/:token", async (c) => {
    if (!tokenMatches(c.req.param("token"), token)) {
      jsonLog("warning", "Rejected unauthorized Xcode Cloud webhook");
      return c.text("unauthorized\n", 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.text("bad json\n", 400);
    }

    let payload;
    try {
      payload = XcodeCloudPayloadSchema.parse(body);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        return c.json({ error: "bad payload", issues: error.issues }, 400);
      }
      throw error;
    }

    const event = normalizeXcodeCloudPayload(payload);
    const outcome = classifyBuild(event);

    if (outcome === "ignore") {
      jsonLog("info", "Ignoring non-terminal / non-failure build event", {
        eventType: event.eventType,
        executionProgress: event.executionProgress,
        completionStatus: event.completionStatus,
        workflow: event.workflowName,
        branch: event.branch,
      });
      return c.text("ignored\n");
    }

    const alert = buildAlert(event, outcome, now(), ttlMs);
    try {
      await poster([alert]);
    } catch (error: unknown) {
      Sentry.withScope((scope) => {
        scope.setTag("component", COMPONENT);
        scope.setContext("xcodeCloudWebhook", {
          outcome,
          workflow: event.workflowName,
          branch: event.branch,
          buildNumber: event.buildNumber,
          completionStatus: event.completionStatus,
        });
        Sentry.captureException(error);
      });
      jsonLog("error", "Failed to POST alert to Alertmanager", {
        outcome,
        workflow: event.workflowName,
        branch: event.branch,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.text("alert post failed\n", 500);
    }

    jsonLog("info", "Forwarded Xcode Cloud build outcome to Alertmanager", {
      outcome,
      workflow: event.workflowName,
      branch: event.branch,
      buildNumber: event.buildNumber,
      completionStatus: event.completionStatus,
    });
    return c.text(`${outcome}\n`);
  });

  return app;
}

function readTtlMs(): number {
  const raw = Bun.env["XCODE_CLOUD_ALERT_TTL_SECONDS"];
  if (raw === undefined || raw === "") {
    return DEFAULT_ALERT_TTL_SECONDS * 1000;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `XCODE_CLOUD_ALERT_TTL_SECONDS must be a positive integer, got ${raw}`,
    );
  }
  return parsed * 1000;
}

export function startXcodeCloudWebhook(): XcodeCloudWebhookHandle {
  const token = Bun.env["XCODE_CLOUD_WEBHOOK_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error(
      "XCODE_CLOUD_WEBHOOK_TOKEN environment variable is required",
    );
  }
  const alertmanagerUrl = Bun.env["ALERTMANAGER_URL"];
  if (alertmanagerUrl === undefined || alertmanagerUrl === "") {
    throw new Error("ALERTMANAGER_URL environment variable is required");
  }
  const port = Number.parseInt(
    Bun.env["XCODE_CLOUD_WEBHOOK_PORT"] ?? String(DEFAULT_PORT),
    10,
  );

  const app = buildXcodeCloudWebhookApp(
    token,
    createAlertmanagerPoster(alertmanagerUrl),
    { ttlMs: readTtlMs() },
  );

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
  });

  jsonLog("info", "Xcode Cloud webhook server started", { port });

  return {
    port,
    async close() {
      await server.stop();
      jsonLog("info", "Xcode Cloud webhook server stopped");
    },
  };
}
