import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { z } from "zod";

export const AlertScopeSchema = z.enum(["ops", "house", "all"]);
export const SuppressionStateSchema = z.enum([
  "none",
  "silenced",
  "inhibited",
  "unprocessed",
]);

const AlertSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  alertname: z.string(),
  namespace: z.string().nullable(),
  severity: z.enum(["critical", "warning", "info", "unknown"]),
  summary: z.string(),
  lifecycleState: z.enum(["open", "resolved"]),
  suppressionState: SuppressionStateSchema,
  resolutionSource: z.enum(["webhook", "reconciled"]).nullable(),
  openedAt: z.string(),
  resolvedAt: z.string().nullable(),
  lastSeenAt: z.string(),
  generatorUrl: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()),
});
const AlertListSchema = z.object({
  items: z.array(AlertSchema),
  nextCursor: z.string().nullable(),
});
const EventSchema = z.object({
  id: z.string(),
  occurrenceId: z.string(),
  type: z.string(),
  occurredAt: z.string(),
  source: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
});
const AlertDetailSchema = AlertSchema.extend({ events: z.array(EventSchema) });
const RequestedLimitSchema = z.coerce.number().int().positive();

export type Alert = z.infer<typeof AlertSchema>;
export type AlertDetail = z.infer<typeof AlertDetailSchema>;

function baseUrl(): string {
  return z
    .url()
    .parse(Bun.env["ALERT_DASHBOARD_URL"] ?? APP_HOSTS.hub)
    .replace(/\/$/u, "");
}

async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`Alerts API returned ${String(response.status)}: ${body}`);
  return schema.parse(JSON.parse(body));
}

function parseRequestedLimit(
  query: Readonly<Record<string, string>>,
): number | undefined {
  if (query["scope"] !== undefined) {
    AlertScopeSchema.parse(query["scope"]);
  }
  if (query["suppressionState"] !== undefined) {
    SuppressionStateSchema.parse(query["suppressionState"]);
  }
  const rawLimit = query["limit"];
  return rawLimit === undefined || rawLimit === "all"
    ? undefined
    : RequestedLimitSchema.parse(rawLimit);
}

function buildAlertPageParams(
  query: Readonly<Record<string, string>>,
  pageSize: number,
  cursor: string | undefined,
): URLSearchParams {
  const params = new URLSearchParams(query);
  if (params.get("lifecycleState") === "all") params.delete("lifecycleState");
  params.set("limit", String(pageSize));
  if (cursor === undefined) params.delete("cursor");
  else params.set("cursor", cursor);
  return params;
}

export async function listAlerts(
  query: Readonly<Record<string, string>>,
): Promise<readonly Alert[]> {
  const requestedLimit = parseRequestedLimit(query);
  const pageSize = Math.min(requestedLimit ?? 100, 100);
  const alerts: Alert[] = [];
  const seenCursors = new Set<string>();
  let cursor = query["cursor"];
  if (cursor !== undefined) seenCursors.add(cursor);
  do {
    const params = buildAlertPageParams(query, pageSize, cursor);
    const result = await request(
      `/api/v1/alerts?${params.toString()}`,
      AlertListSchema,
    );
    alerts.push(...result.items);
    if (requestedLimit !== undefined && alerts.length >= requestedLimit)
      return alerts.slice(0, requestedLimit);
    if (result.nextCursor === null) {
      cursor = undefined;
      continue;
    }
    if (seenCursors.has(result.nextCursor))
      throw new Error("Alerts API repeated a pagination cursor");
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  } while (cursor !== undefined);
  return alerts;
}

export function getAlert(id: string): Promise<AlertDetail> {
  return request(`/api/v1/alerts/${encodeURIComponent(id)}`, AlertDetailSchema);
}
