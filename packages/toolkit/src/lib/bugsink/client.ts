import type { z } from "zod";
import { requireEnv } from "#lib/config.ts";
import { createHttpClient, type HttpClient } from "#lib/http.ts";
import { BugsinkPaginatedResponseSchema } from "./schemas.ts";
import type { BugsinkPaginatedResponse } from "./types.ts";

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

function client(): HttpClient {
  return createHttpClient(() => {
    const baseUrl = requireEnv(
      "BUGSINK_URL",
      "Bugsink instance URL, e.g. https://bugsink.example.com",
    )
      .replace(/\/$/, "")
      .replace(/\/api\/canonical\/0$/, "");
    const authToken = requireEnv("BUGSINK_TOKEN", "Bugsink API token");
    return {
      baseUrl,
      auth: { scheme: "Bearer", token: authToken },
      errorLabel: "Bugsink API",
      normalizeUrl: buildBugsinkApiUrl,
    };
  });
}

export async function bugsinkRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  params?: Record<string, string>,
): Promise<BugsinkClientResult<T>> {
  return client().get(endpoint, { schema, query: params });
}

export type BugsinkPaginatedOptions = {
  /** Max total items to return. Stops fetching once reached. */
  limit?: number | undefined;
  /** Safety cap on pages fetched. Defaults to 100. */
  maxPages?: number | undefined;
};

function validateBugsinkLimit(limit: number | undefined): string | null {
  if (limit == null) {
    return null;
  }
  return !Number.isInteger(limit) || limit < 0
    ? `Invalid limit: ${String(limit)}. Expected a non-negative integer.`
    : null;
}

type FetchBugsinkPageArgs<T> = {
  http: HttpClient;
  endpoint: string;
  pageSchema: z.ZodType<BugsinkPaginatedResponse<T>>;
  params: Record<string, string> | undefined;
  seen: Set<string>;
  nextUrl: string | null;
};

async function fetchBugsinkPage<T>(
  args: FetchBugsinkPageArgs<T>,
): Promise<BugsinkClientResult<BugsinkPaginatedResponse<T>>> {
  const { http, endpoint, pageSchema, params, seen, nextUrl } = args;
  if (nextUrl == null) {
    return http.get(endpoint, { schema: pageSchema, query: params });
  }
  if (seen.has(nextUrl)) {
    return {
      success: false,
      error: `Bugsink API pagination cycle detected at ${nextUrl}`,
    };
  }
  seen.add(nextUrl);
  return http.getUrl(nextUrl, { schema: pageSchema });
}

function collectPageResults<T>(
  all: T[],
  results: readonly T[],
  limit: number | undefined,
): boolean {
  for (const item of results) {
    if (limit != null && all.length >= limit) {
      break;
    }
    all.push(item);
  }
  return limit != null && all.length >= limit;
}

function normalizeNextUrl(next: string | null): string | null {
  return next == null || next.length === 0 ? null : next;
}

export async function bugsinkRequestPaginated<T>(
  endpoint: string,
  itemSchema: z.ZodType<T>,
  params?: Record<string, string>,
  options: BugsinkPaginatedOptions = {},
): Promise<BugsinkClientResult<T[]>> {
  const { limit, maxPages = 100 } = options;

  const limitError = validateBugsinkLimit(limit);
  if (limitError != null) {
    return { success: false, error: limitError };
  }
  if (limit === 0) {
    return { success: true, data: [] };
  }

  const PageSchema = BugsinkPaginatedResponseSchema(itemSchema);
  const http = client();
  const all: T[] = [];
  const seen = new Set<string>();
  let nextUrl: string | null = null;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await fetchBugsinkPage({
      http,
      endpoint,
      pageSchema: PageSchema,
      params,
      seen,
      nextUrl,
    });
    if (!page.success || page.data == null) {
      const suffix = pageNumber === 1 ? "" : ` (page ${String(pageNumber)})`;
      return {
        success: false,
        error: `${page.error ?? "Failed to fetch page"}${suffix}`,
      };
    }
    if (collectPageResults(all, page.data.results, limit)) {
      return { success: true, data: all.slice(0, limit) };
    }
    nextUrl = normalizeNextUrl(page.data.next);
    if (nextUrl == null) {
      return { success: true, data: all };
    }
  }

  return {
    success: false,
    error: `Bugsink API pagination exceeded ${String(maxPages)} pages`,
  };
}

export async function bugsinkRequestRaw(
  endpoint: string,
  params?: Record<string, string>,
): Promise<BugsinkRawResult> {
  return client().raw(endpoint, { query: params });
}

export async function bugsinkRequestPostRaw(
  endpoint: string,
  body: unknown,
): Promise<BugsinkRawResult> {
  return client().postRaw(endpoint, { body });
}

export function buildBugsinkApiUrl(baseUrl: string, endpoint: string): URL {
  const normalizedBase = baseUrl
    .replace(/\/$/, "")
    .replace(/\/api\/canonical\/0$/, "");
  return new URL(`${normalizedBase}/api/canonical/0${endpoint}`);
}
