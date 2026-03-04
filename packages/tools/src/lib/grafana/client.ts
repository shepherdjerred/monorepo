import type { z } from "zod";

export type GrafanaClientResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

function getBaseUrl(): string {
  const baseUrl = Bun.env["GRAFANA_URL"];
  if (baseUrl == null || baseUrl.length === 0) {
    throw new Error("GRAFANA_URL environment variable is not set");
  }
  return baseUrl.replace(/\/$/, "");
}

function getApiKey(): string {
  const apiKey = Bun.env["GRAFANA_API_KEY"];
  if (apiKey == null || apiKey.length === 0) {
    throw new Error("GRAFANA_API_KEY environment variable is not set");
  }
  return apiKey;
}

export async function grafanaRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  params?: Record<string, string>,
): Promise<GrafanaClientResult<T>> {
  try {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    const url = new URL(`${baseUrl}${endpoint}`);

    if (params != null) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Grafana API error (${String(response.status)}): ${errorText}`,
      };
    }

    const json: unknown = await response.json();
    const data = schema.parse(json);
    return { success: true, data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function grafanaPost<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  body: unknown,
): Promise<GrafanaClientResult<T>> {
  try {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    const url = new URL(`${baseUrl}${endpoint}`);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Grafana API error (${String(response.status)}): ${errorText}`,
      };
    }

    const json: unknown = await response.json();
    const data = schema.parse(json);
    return { success: true, data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function grafanaRequestRaw(
  endpoint: string,
  params?: Record<string, string>,
): Promise<GrafanaClientResult<string>> {
  try {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    const url = new URL(`${baseUrl}${endpoint}`);

    if (params != null) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Grafana API error (${String(response.status)}): ${errorText}`,
      };
    }

    const text = await response.text();
    return { success: true, data: text };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}
