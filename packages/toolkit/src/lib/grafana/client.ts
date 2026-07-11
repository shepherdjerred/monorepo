import type { z } from "zod";
import { requireEnv } from "#lib/config.ts";
import { createHttpClient, type HttpClient } from "#lib/http.ts";

export type GrafanaClientResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

function client(): HttpClient {
  return createHttpClient(() => {
    const baseUrl = requireEnv("GRAFANA_URL", "Grafana instance URL").replace(
      /\/$/,
      "",
    );
    const apiKey = requireEnv(
      "GRAFANA_API_KEY",
      "Grafana API key or service account token",
    );
    return {
      baseUrl,
      auth: { scheme: "Bearer", token: apiKey },
      errorLabel: "Grafana API",
    };
  });
}

export async function grafanaRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  params?: Record<string, string>,
): Promise<GrafanaClientResult<T>> {
  return client().get(endpoint, { schema, query: params });
}

export async function grafanaPost<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  body: unknown,
): Promise<GrafanaClientResult<T>> {
  return client().post(endpoint, { schema, body });
}

export async function grafanaRequestRaw(
  endpoint: string,
  params?: Record<string, string>,
): Promise<GrafanaClientResult<string>> {
  return client().raw(endpoint, { query: params });
}
