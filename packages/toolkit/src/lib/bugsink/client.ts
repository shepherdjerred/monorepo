import type { z } from "zod";
import { requireEnv } from "#lib/config.ts";
import { createHttpClient, type HttpClient } from "#lib/http.ts";

export type BugsinkRawResult = {
  success: boolean;
  data?: string | undefined;
  error?: string | undefined;
};

export type BugsinkClientResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

function getBaseUrl(): string {
  return requireEnv(
    "BUGSINK_URL",
    "Bugsink instance URL, e.g. https://bugsink.example.com",
  )
    .replace(/\/$/, "")
    .replace(/\/api\/canonical\/0$/, "");
}

function client(): HttpClient {
  const baseUrl = getBaseUrl();
  const authToken = requireEnv("BUGSINK_TOKEN", "Bugsink API token");
  return createHttpClient({
    baseUrl,
    auth: { scheme: "Bearer", token: authToken },
    errorLabel: "Bugsink API",
    normalizeUrl: buildBugsinkApiUrl,
  });
}

export async function bugsinkRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  params?: Record<string, string>,
): Promise<BugsinkClientResult<T>> {
  return client().get(endpoint, { schema, query: params });
}

export async function bugsinkRequestRaw(
  endpoint: string,
  params?: Record<string, string>,
): Promise<BugsinkRawResult> {
  return client().raw(endpoint, { query: params });
}

export function buildBugsinkApiUrl(baseUrl: string, endpoint: string): URL {
  const normalizedBase = baseUrl
    .replace(/\/$/, "")
    .replace(/\/api\/canonical\/0$/, "");
  return new URL(`${normalizedBase}/api/canonical/0${endpoint}`);
}
