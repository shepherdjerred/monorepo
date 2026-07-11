import type { z } from "zod";

/**
 * Shared HTTP client for toolkit's fetch-based service clients.
 *
 * Every service client (Grafana, PagerDuty, Bugsink) followed the same shape:
 * build a URL from a base + endpoint, attach an auth header, fetch, and on a
 * non-2xx response return a `{ success: false, error }` envelope carrying the
 * response body. On success the body is parsed with a Zod schema. Any thrown
 * error (network failure, non-JSON body, config lookup, or a Zod parse
 * failure) is caught once and flattened to `{ success: false, error }`. This
 * module centralizes that behavior so each client only declares its base URL,
 * auth, and error-message prefix.
 *
 * `createHttpClient` accepts either `HttpClientOptions` or a
 * `() => HttpClientOptions` factory. Service clients that read env vars (via
 * `requireEnv`) pass a factory so the lookup runs inside `get`/`post`/`raw`'s
 * own `try`, keeping a missing env var inside the standard envelope instead of
 * rejecting the returned promise.
 */

/** Standard response envelope shared by every service client. */
export type HttpResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

/**
 * Authentication descriptor. `scheme` is the exact prefix written before the
 * token in the `Authorization` header:
 *
 * - `Bearer` produces `Authorization: Bearer <token>` (Grafana, Bugsink).
 * - `Token token=` produces `Authorization: Token token=<token>` (PagerDuty).
 */
export type HttpAuth =
  | { scheme: "Bearer"; token: string }
  | { scheme: "Token token="; token: string };

function authorizationHeader(auth: HttpAuth): string {
  switch (auth.scheme) {
    case "Bearer":
      return `Bearer ${auth.token}`;
    case "Token token=":
      return `Token token=${auth.token}`;
  }
}

/** Query values: a scalar is `set`, an array is `append`-ed once per element. */
export type QueryParams = Record<string, string | string[]>;

function wrapError(error: unknown): HttpResult<never> {
  const message =
    error instanceof Error ? error.message : "Unknown error occurred";
  return { success: false, error: message };
}

function applyQueryParams(url: URL, params: QueryParams): void {
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

export type HttpClientOptions = {
  /** Base URL prepended to every endpoint (no trailing normalization done). */
  baseUrl: string;
  /** Authentication written into the `Authorization` header. */
  auth: HttpAuth;
  /** Prefix for wrapped API errors, e.g. `"Grafana API"`. */
  errorLabel: string;
  /** Extra headers merged into every request (e.g. PagerDuty's `Accept`). */
  headers?: Record<string, string> | undefined;
  /**
   * Optional URL builder hook. When provided, it fully owns turning
   * `(baseUrl, endpoint)` into the request `URL` — used by Bugsink to insert
   * its `/api/canonical/0` prefix. When omitted, the URL is
   * `new URL(baseUrl + endpoint)`.
   */
  normalizeUrl?: ((baseUrl: string, endpoint: string) => URL) | undefined;
};

export type HttpGetOptions<T> = {
  schema?: z.ZodType<T> | undefined;
  query?: QueryParams | undefined;
};

export type HttpPostOptions<T> = {
  body?: unknown;
  schema?: z.ZodType<T> | undefined;
  query?: QueryParams | undefined;
};

export type HttpClient = {
  /** GET `endpoint`, parse the JSON body with `schema`. */
  get: <T>(
    endpoint: string,
    options: HttpGetOptions<T> & { schema: z.ZodType<T> },
  ) => Promise<HttpResult<T>>;
  /** POST `endpoint`, parse the JSON body with `schema`. */
  post: <T>(
    endpoint: string,
    options: HttpPostOptions<T> & { schema: z.ZodType<T> },
  ) => Promise<HttpResult<T>>;
  /** GET `endpoint`, return the raw text body (no JSON parse). */
  raw: (
    endpoint: string,
    options?: { query?: QueryParams | undefined },
  ) => Promise<HttpResult<string>>;
};

/**
 * Build an `HttpClient` from options that may themselves throw (e.g. a
 * `requireEnv` lookup baked into `optionsOrFactory`). Every entry point below
 * calls this inside its own `try` so a thrown config error is caught and
 * flattened to the same `{ success: false, error }` envelope as a request
 * failure, matching the pre-refactor per-client `try/catch` behavior.
 */
function resolveOptions(
  optionsOrFactory: HttpClientOptions | (() => HttpClientOptions),
): HttpClientOptions {
  return typeof optionsOrFactory === "function"
    ? optionsOrFactory()
    : optionsOrFactory;
}

export function createHttpClient(
  optionsOrFactory: HttpClientOptions | (() => HttpClientOptions),
): HttpClient {
  function buildUrl(
    options: HttpClientOptions,
    endpoint: string,
    query?: QueryParams,
  ): URL {
    const { baseUrl, normalizeUrl } = options;
    const url =
      normalizeUrl == null
        ? new URL(`${baseUrl}${endpoint}`)
        : normalizeUrl(baseUrl, endpoint);
    if (query != null) {
      applyQueryParams(url, query);
    }
    return url;
  }

  function jsonHeaders(options: HttpClientOptions): Record<string, string> {
    return {
      Authorization: authorizationHeader(options.auth),
      "Content-Type": "application/json",
      ...options.headers,
    };
  }

  function rawHeaders(options: HttpClientOptions): Record<string, string> {
    return {
      Authorization: authorizationHeader(options.auth),
      ...options.headers,
    };
  }

  async function errorEnvelope(
    options: HttpClientOptions,
    response: Response,
  ): Promise<HttpResult<never>> {
    const errorText = await response.text();
    return {
      success: false,
      error: `${options.errorLabel} error (${String(response.status)}): ${errorText}`,
    };
  }

  async function get<T>(
    endpoint: string,
    getOptions: HttpGetOptions<T> & { schema: z.ZodType<T> },
  ): Promise<HttpResult<T>> {
    try {
      const options = resolveOptions(optionsOrFactory);
      const url = buildUrl(options, endpoint, getOptions.query);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: jsonHeaders(options),
      });
      if (!response.ok) {
        return await errorEnvelope(options, response);
      }
      const json: unknown = await response.json();
      const data = getOptions.schema.parse(json);
      return { success: true, data };
    } catch (error) {
      return wrapError(error);
    }
  }

  async function post<T>(
    endpoint: string,
    postOptions: HttpPostOptions<T> & { schema: z.ZodType<T> },
  ): Promise<HttpResult<T>> {
    try {
      const options = resolveOptions(optionsOrFactory);
      const url = buildUrl(options, endpoint, postOptions.query);
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: jsonHeaders(options),
        body: JSON.stringify(postOptions.body),
      });
      if (!response.ok) {
        return await errorEnvelope(options, response);
      }
      const json: unknown = await response.json();
      const data = postOptions.schema.parse(json);
      return { success: true, data };
    } catch (error) {
      return wrapError(error);
    }
  }

  async function raw(
    endpoint: string,
    rawOptions?: { query?: QueryParams | undefined },
  ): Promise<HttpResult<string>> {
    try {
      const options = resolveOptions(optionsOrFactory);
      const url = buildUrl(options, endpoint, rawOptions?.query);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: rawHeaders(options),
      });
      if (!response.ok) {
        return await errorEnvelope(options, response);
      }
      const text = await response.text();
      return { success: true, data: text };
    } catch (error) {
      return wrapError(error);
    }
  }

  return { get, post, raw };
}
