import type { z } from "zod";
import { requireEnv } from "#lib/config.ts";
import { createHttpClient, type HttpClient } from "#lib/http.ts";

export type PagerDutyClientResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

const PAGERDUTY_BASE_URL = "https://api.pagerduty.com";

function client(): HttpClient {
  const apiKey = requireEnv("PAGERDUTY_TOKEN", "PagerDuty API token");
  return createHttpClient({
    baseUrl: PAGERDUTY_BASE_URL,
    auth: { scheme: "Token token=", token: apiKey },
    errorLabel: "PagerDuty API",
    headers: { Accept: "application/vnd.pagerduty+json;version=2" },
  });
}

export async function pagerDutyRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  params?: Record<string, string | string[]>,
): Promise<PagerDutyClientResult<T>> {
  return client().get(endpoint, { schema, query: params });
}
