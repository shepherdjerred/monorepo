import { z } from "zod";
import { optionalEnv } from "#lib/config.ts";
import { DEFAULT_ERRORS_URL } from "./schemas.ts";

const MAX_SERVER_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 100;

export type ErrorsRequestOptions = {
  readonly baseUrl?: string | undefined;
};

export function errorsBaseUrl(explicitUrl?: string): string {
  const raw = explicitUrl ?? optionalEnv("ERRORS_URL") ?? DEFAULT_ERRORS_URL;
  const parsed = new URL(raw);
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("ERRORS_URL must not include credentials");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("ERRORS_URL must be http or https");
  }
  const pathname = parsed.pathname
    .replace(/\/+$/u, "")
    .replace(/\/api\/v1$/u, "");
  return `${parsed.origin}${pathname}`;
}

export function buildErrorsApiUrl(
  baseUrl: string,
  endpoint: string,
  query?: Record<string, string>,
): URL {
  const normalizedBase = errorsBaseUrl(baseUrl);
  const url = new URL(`${normalizedBase}/api/v1${endpoint}`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function buildHeaders(
  baseUrl: string,
  includeJsonContentType: boolean,
  includeOrigin: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = optionalEnv("ERRORS_TOKEN");
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (includeOrigin) {
    headers["Origin"] = new URL(errorsBaseUrl(baseUrl)).origin;
  }
  return headers;
}

const ApiErrorBodySchema = z.object({ error: z.string().min(1) });

async function readApiError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const parsed = ApiErrorBodySchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      return new Error(
        `Errors API error (${String(response.status)}): ${parsed.data.error}`,
      );
    }
  } catch {
    // Response body is plain text rather than JSON.
  }
  return new Error(`Errors API error (${String(response.status)}): ${text}`);
}

export async function errorsGetJson<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  query?: Record<string, string>,
  options?: ErrorsRequestOptions,
): Promise<T> {
  const baseUrl = errorsBaseUrl(options?.baseUrl);
  const url = buildErrorsApiUrl(baseUrl, endpoint, query);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(baseUrl, false, false),
  });
  if (!response.ok) {
    throw await readApiError(response);
  }
  const json: unknown = await response.json();
  return schema.parse(json);
}

export async function errorsGetText(
  endpoint: string,
  query?: Record<string, string>,
  options?: ErrorsRequestOptions,
): Promise<string> {
  const baseUrl = errorsBaseUrl(options?.baseUrl);
  const url = buildErrorsApiUrl(baseUrl, endpoint, query);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(baseUrl, false, false),
  });
  if (!response.ok) {
    throw await readApiError(response);
  }
  return response.text();
}

export type ErrorsSendJsonArgs<T> = {
  readonly method: "POST" | "PATCH";
  readonly endpoint: string;
  readonly body: unknown;
  readonly schema: z.ZodType<T>;
  readonly options?: ErrorsRequestOptions | undefined;
};

export async function errorsSendJson<T>(
  args: ErrorsSendJsonArgs<T>,
): Promise<T> {
  const baseUrl = errorsBaseUrl(args.options?.baseUrl);
  const url = buildErrorsApiUrl(baseUrl, args.endpoint);
  const response = await fetch(url.toString(), {
    method: args.method,
    headers: buildHeaders(baseUrl, true, true),
    body: JSON.stringify(args.body),
  });
  if (!response.ok) {
    throw await readApiError(response);
  }
  const json: unknown = await response.json();
  return args.schema.parse(json);
}

function validatePaginationBounds(
  limit: number | undefined,
  maxPages: number | undefined,
): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error(
      `Invalid limit: ${String(limit)}. Expected a non-negative integer.`,
    );
  }
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) {
    throw new Error(
      `Invalid maxPages: ${String(maxPages)}. Expected a positive integer.`,
    );
  }
}

function resolvePageLimit(
  limit: number | undefined,
  collectedCount: number,
): number {
  return limit === undefined
    ? MAX_SERVER_PAGE_SIZE
    : Math.min(MAX_SERVER_PAGE_SIZE, limit - collectedCount);
}

function advanceCursor(
  nextCursor: string | null,
  seenCursors: Set<string>,
): string | null {
  if (nextCursor === null || nextCursor.length === 0) {
    return null;
  }
  if (seenCursors.has(nextCursor)) {
    throw new Error(
      `Errors API pagination cycle detected at cursor ${nextCursor}`,
    );
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

export type CursorPage<T> = {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
};

export type CollectCursorPagesArgs<T> = {
  readonly endpoint: string;
  readonly pageSchema: z.ZodType<CursorPage<T>>;
  readonly baseQuery: Record<string, string>;
  readonly followCursors: boolean;
  readonly limit?: number | undefined;
  readonly maxPages?: number | undefined;
  readonly options?: ErrorsRequestOptions | undefined;
};

export async function collectCursorPages<T>(
  args: CollectCursorPagesArgs<T>,
): Promise<T[]> {
  const {
    endpoint,
    pageSchema,
    baseQuery,
    followCursors,
    limit,
    maxPages = DEFAULT_MAX_PAGES,
    options,
  } = args;
  validatePaginationBounds(limit, maxPages);
  if (limit === 0) {
    return [];
  }
  if (!followCursors && limit === undefined) {
    const page = await errorsGetJson(endpoint, pageSchema, baseQuery, options);
    return [...page.items];
  }

  const collected: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const pageQuery: Record<string, string> = {
      ...baseQuery,
      limit: String(resolvePageLimit(limit, collected.length)),
      ...(cursor === null ? {} : { cursor }),
    };
    const page = await errorsGetJson(endpoint, pageSchema, pageQuery, options);
    collected.push(...page.items);
    if (limit !== undefined && collected.length >= limit) {
      return collected.slice(0, limit);
    }
    cursor = advanceCursor(page.nextCursor, seenCursors);
    if (cursor === null) {
      return collected;
    }
  }

  throw new Error(
    `Errors API pagination exceeded ${String(maxPages)} pages; narrow your query or pass --limit`,
  );
}
