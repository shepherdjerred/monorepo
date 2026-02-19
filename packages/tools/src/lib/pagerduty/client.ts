import type { z } from "zod";

export type PagerDutyClientResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

const PAGERDUTY_BASE_URL = "https://api.pagerduty.com";

function getApiKey(): string {
  const apiKey = Bun.env["PAGERDUTY_API_KEY"];
  if (apiKey == null || apiKey.length === 0) {
    throw new Error("PAGERDUTY_API_KEY environment variable is not set");
  }
  return apiKey;
}

function applySearchParams(
  url: URL,
  params: Record<string, string | string[]>,
): void {
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        url.searchParams.append(key, v);
      }
    } else {
      url.searchParams.set(key, value);
    }
  }
}

export async function pagerDutyRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  params?: Record<string, string | string[]>,
): Promise<PagerDutyClientResult<T>> {
  try {
    const apiKey = getApiKey();
    const url = new URL(`${PAGERDUTY_BASE_URL}${endpoint}`);

    if (params != null) {
      applySearchParams(url, params);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Token token=${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.pagerduty+json;version=2",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `PagerDuty API error (${String(response.status)}): ${errorText}`,
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
