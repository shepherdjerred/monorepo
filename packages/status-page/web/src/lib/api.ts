import { z } from "zod";

const envUrl = String(import.meta.env["PUBLIC_STATUS_API_URL"] ?? "");
const BASE_URL = envUrl || "https://status-api.sjer.red";

const SiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Site = z.infer<typeof SiteSchema>;

const ComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["operational", "degraded", "partial_outage", "major_outage"]),
  displayOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Component = z.infer<typeof ComponentSchema>;

const IncidentUpdateSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  message: z.string(),
  createdAt: z.string(),
});

export type IncidentUpdate = z.infer<typeof IncidentUpdateSchema>;

const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  impact: z.enum(["none", "minor", "major", "critical"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  updates: z.array(IncidentUpdateSchema),
  components: z.array(ComponentSchema),
});

export type Incident = z.infer<typeof IncidentSchema>;

const UptimeEntrySchema = z.object({
  date: z.string(),
  uptimePercentage: z.number(),
  totalChecks: z.number(),
  successfulChecks: z.number(),
});

export type UptimeEntry = z.infer<typeof UptimeEntrySchema>;

const ComponentUptimeSchema = z.object({
  componentId: z.string(),
  componentName: z.string(),
  entries: z.array(UptimeEntrySchema),
  overallUptime: z.number(),
});

export type ComponentUptime = z.infer<typeof ComponentUptimeSchema>;

const StatusSummarySchema = z.object({
  status: z.enum(["operational", "degraded", "partial_outage", "major_outage"]),
  components: z.array(ComponentSchema),
  activeIncidents: z.array(IncidentSchema),
  recentIncidents: z.array(IncidentSchema),
});

export type StatusSummary = z.infer<typeof StatusSummarySchema>;

const ApiErrorSchema = z.object({
  error: z.string(),
});

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options?.headers) {
      const optHeaders = options.headers;
      if (optHeaders instanceof Headers) {
        optHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(optHeaders)) {
        for (const [key, value] of optHeaders) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, optHeaders);
      }
    }
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    });
    const text = await response.text();
    const json: unknown = JSON.parse(text);
    if (!response.ok) {
      const errorResult = ApiErrorSchema.safeParse(json);
      if (errorResult.success) {
        return { ok: false, error: errorResult.data.error };
      }
      return { ok: false, error: "Unknown error" };
    }
    const result = schema.safeParse(json);
    if (result.success) {
      return { ok: true, data: result.data };
    }
    return { ok: false, error: "Invalid response format" };
  } catch {
    return { ok: false, error: "Unable to fetch live status" };
  }
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

// Site endpoints

export async function getSites(): Promise<ApiResult<Site[]>> {
  return apiFetch("/api/sites", z.array(SiteSchema));
}

export async function createSite(
  apiKey: string,
  data: { id: string; name: string; url?: string },
): Promise<ApiResult<Site>> {
  return apiFetch("/api/sites", SiteSchema, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(data),
  });
}

export async function updateSite(
  apiKey: string,
  siteId: string,
  data: { name?: string; url?: string | null },
): Promise<ApiResult<Site>> {
  return apiFetch(`/api/sites/${siteId}`, SiteSchema, {
    method: "PUT",
    headers: authHeaders(apiKey),
    body: JSON.stringify(data),
  });
}

export async function deleteSite(
  apiKey: string,
  siteId: string,
): Promise<ApiResult<{ success: boolean }>> {
  return apiFetch(`/api/sites/${siteId}`, z.object({ success: z.boolean() }), {
    method: "DELETE",
    headers: authHeaders(apiKey),
  });
}

// Per-site endpoints

export async function getStatus(
  siteId: string,
): Promise<ApiResult<StatusSummary>> {
  return apiFetch(`/api/sites/${siteId}/status`, StatusSummarySchema);
}

export async function getComponents(
  siteId: string,
): Promise<ApiResult<Component[]>> {
  return apiFetch(`/api/sites/${siteId}/components`, z.array(ComponentSchema));
}

export async function getIncidents(
  siteId: string,
): Promise<ApiResult<Incident[]>> {
  return apiFetch(`/api/sites/${siteId}/incidents`, z.array(IncidentSchema));
}

export async function getUptime(
  siteId: string,
  days = 90,
): Promise<ApiResult<ComponentUptime[]>> {
  return apiFetch(
    `/api/sites/${siteId}/uptime?days=${String(days)}`,
    z.array(ComponentUptimeSchema),
  );
}

export async function createIncident(
  apiKey: string,
  siteId: string,
  data: {
    title: string;
    status: string;
    impact: string;
    message: string;
    componentIds?: string[];
  },
): Promise<ApiResult<Incident>> {
  return apiFetch(`/api/sites/${siteId}/incidents`, IncidentSchema, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(data),
  });
}

export async function updateIncident(
  apiKey: string,
  siteId: string,
  incidentId: string,
  data: { status?: string; impact?: string },
): Promise<ApiResult<Incident>> {
  return apiFetch(
    `/api/sites/${siteId}/incidents/${incidentId}`,
    IncidentSchema,
    {
      method: "PUT",
      headers: authHeaders(apiKey),
      body: JSON.stringify(data),
    },
  );
}

export async function addIncidentUpdate(
  apiKey: string,
  siteId: string,
  incidentId: string,
  data: { status: string; message: string },
): Promise<ApiResult<IncidentUpdate>> {
  return apiFetch(
    `/api/sites/${siteId}/incidents/${incidentId}/updates`,
    IncidentUpdateSchema,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(data),
    },
  );
}

export async function updateComponent(
  apiKey: string,
  siteId: string,
  componentId: string,
  data: { status: string },
): Promise<ApiResult<Component>> {
  return apiFetch(
    `/api/sites/${siteId}/components/${componentId}`,
    ComponentSchema,
    {
      method: "PUT",
      headers: authHeaders(apiKey),
      body: JSON.stringify(data),
    },
  );
}

export async function createComponent(
  apiKey: string,
  siteId: string,
  data: { name: string; description?: string },
): Promise<ApiResult<Component>> {
  return apiFetch(`/api/sites/${siteId}/components`, ComponentSchema, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(data),
  });
}
