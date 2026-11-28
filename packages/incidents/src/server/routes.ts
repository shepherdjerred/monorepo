/**
 * REST routes mounted under `/api/incidents`: the live stream and the two
 * machine signal producers. Commands and queries go through tRPC.
 */
import type { Context, Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import {
  incidentIdentifier,
  INCIDENT_STREAM_EVENT,
  IncidentSignalBatchSchema,
  parseIncidentNumber,
  type IncidentStreamFrame,
} from "#shared/contract.ts";
import { AlertmanagerWebhookSchema } from "#shared/alertmanager.ts";
import { hasBearer } from "#server/bearer.ts";
import type { IncidentEventBus } from "#server/event-bus.ts";
import type { IncidentsService } from "#server/service.ts";

/** Below Bun's default 10 s idle timeout, so idle streams stay open. */
export const DEFAULT_HEARTBEAT_MS = 8000;
/** A subscriber this far behind is cut off; it reconnects and refetches. */
const MAX_QUEUED = 1000;

export type IncidentRoutesOptions = {
  readonly service: IncidentsService;
  readonly bus: IncidentEventBus;
  /** Alertmanager receiver bearer token; the route answers 503 without one. */
  readonly webhookToken: string | undefined;
  /** Bearer token for `/internal/signals` (Temporal ops-snapshot). */
  readonly opsIngestToken: string | undefined;
  readonly heartbeatMs: number;
};

function waiter(heartbeatMs: number) {
  let wake: (() => void) | undefined;
  return {
    wake: () => wake?.(),
    idle: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => wake?.(), heartbeatMs);
        wake = () => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
      }),
  };
}

async function pump(
  stream: SSEStreamingApi,
  options: IncidentRoutesOptions,
  identifier: string | null,
): Promise<void> {
  const queue: IncidentStreamFrame[] = [];
  const state = { open: true, overflowed: false };
  const live = () => state.open && !state.overflowed && !stream.aborted;
  const signal = waiter(options.heartbeatMs);
  const unsubscribe = options.bus.subscribe((frame) => {
    if (identifier !== null && frame.identifier !== identifier) return;
    if (queue.length >= MAX_QUEUED) state.overflowed = true;
    else queue.push(frame);
    signal.wake();
  });
  stream.onAbort(() => {
    state.open = false;
    signal.wake();
  });
  try {
    await stream.write("retry: 3000\n: connected\n\n");
    while (live()) {
      const frame = queue.shift();
      if (frame !== undefined) {
        await stream.writeSSE({
          event: INCIDENT_STREAM_EVENT,
          id: `${frame.incidentId}:${String(frame.revision)}`,
          data: JSON.stringify(frame),
        });
        continue;
      }
      await signal.idle();
      if (queue.length > 0 || !live()) continue;
      // Turning incidents off ends open streams within one heartbeat.
      const settings = await options.service.settings();
      if (!settings.enabled) break;
      await stream.write(": heartbeat\n\n");
    }
  } finally {
    unsubscribe();
  }
}

async function jsonBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return undefined;
  }
}

function authorize(
  context: Context,
  token: string | undefined,
): Response | null {
  if (token === undefined || token === "")
    return context.json({ error: "Receiver is not configured" }, 503);
  return hasBearer(context.req.header("authorization"), token)
    ? null
    : context.json({ error: "Unauthorized" }, 401);
}

export function registerIncidentRoutes(
  app: Hono,
  options: IncidentRoutesOptions,
): void {
  app.get("/events/stream", async (context) => {
    const settings = await options.service.settings();
    if (!settings.enabled) return context.json({ error: "Not found" }, 404);
    const filter = context.req.query("incident");
    const number = filter === undefined ? null : parseIncidentNumber(filter);
    if (filter !== undefined && number === null)
      return context.json(
        { error: `"${filter}" is not an incident reference` },
        400,
      );
    const identifier = number === null ? null : incidentIdentifier(number);
    return streamSSE(context, (stream) => pump(stream, options, identifier));
  });

  app.post("/alertmanager", async (context) => {
    const refused = authorize(context, options.webhookToken);
    if (refused !== null) return refused;
    const parsed = AlertmanagerWebhookSchema.safeParse(await jsonBody(context));
    return parsed.success
      ? context.json(await options.service.alertmanager(parsed.data), 202)
      : context.json(
          {
            error: "Invalid Alertmanager webhook",
            issues: parsed.error.issues,
          },
          400,
        );
  });

  app.post("/internal/signals", async (context) => {
    const refused = authorize(context, options.opsIngestToken);
    if (refused !== null) return refused;
    const parsed = IncidentSignalBatchSchema.safeParse(await jsonBody(context));
    return parsed.success
      ? context.json(
          await options.service.applySignals(parsed.data.signals),
          202,
        )
      : context.json(
          { error: "Invalid signal batch", issues: parsed.error.issues },
          400,
        );
  });
}
