import { z } from "zod";

const AlertSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  alertname: z.string(),
  namespace: z.string().nullable(),
  severity: z.enum(["critical", "warning", "info", "unknown"]),
  summary: z.string(),
  lifecycleState: z.enum(["open", "resolved"]),
  suppressionState: z.enum(["none", "silenced", "inhibited", "unprocessed"]),
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
    .parse(
      Bun.env["ALERT_DASHBOARD_URL"] ?? "https://alerts.tailnet-1a49.ts.net",
    )
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

export async function listAlerts(
  query: Readonly<Record<string, string>>,
): Promise<readonly Alert[]> {
  const requestedLimit =
    query["limit"] === undefined
      ? undefined
      : RequestedLimitSchema.parse(query["limit"]);
  const pageSize = Math.min(requestedLimit ?? 100, 100);
  const alerts: Alert[] = [];
  const seenCursors = new Set<string>();
  let cursor = query["cursor"];
  if (cursor !== undefined) seenCursors.add(cursor);
  do {
    const params = new URLSearchParams(query);
    params.set("limit", String(pageSize));
    if (cursor === undefined) params.delete("cursor");
    else params.set("cursor", cursor);
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
