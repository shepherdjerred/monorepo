/**
 * The REST fetch point shared by the review gate and toolkit: GitHub headers,
 * ETag conditional requests, and typed rate-limit failures.
 *
 * Every REST call authenticated as one user draws on that user's single
 * 5,000/hr core bucket, and the review gate and `toolkit ci wait` poll the
 * same unchanged endpoints every 30 seconds. GitHub does not charge an
 * authenticated `304 Not Modified` against the primary rate limit, so
 * replaying the last ETag makes a steady-state poll free.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

const GITHUB_API_VERSION = "2022-11-28";

/** Seconds to back off for a secondary limit that names no reset or retry. */
const SECONDARY_LIMIT_BACKOFF_SECONDS = 60;

export function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

/** Extract the `rel="next"` URL from a GitHub `Link` header, if present. */
export function parseLinkNext(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/u.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

export type RateLimitDetails = {
  status: number;
  resource: string | null;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  /** When the primary bucket resets (`x-ratelimit-reset`). */
  resetAt: Date | null;
  /** GitHub's explicit back-off for secondary limits (`retry-after`). */
  retryAfterSeconds: number | null;
};

/**
 * GitHub refused a request because a rate limit is exhausted. Carries the
 * response's limit headers so callers can wait for the reset instead of
 * reporting a quota blip as a contract failure.
 */
export class GitHubRateLimitError extends Error {
  /** Epoch milliseconds after which the request may be retried. */
  readonly resumeAt: number;

  constructor(
    readonly path: string,
    readonly details: RateLimitDetails,
    now: number = Date.now(),
  ) {
    const resumeAt = rateLimitResumeAt(details, now);
    const usage =
      details.used === null || details.limit === null
        ? ""
        : ` (used ${String(details.used)}/${String(details.limit)})`;
    super(
      `GitHub ${details.resource ?? "API"} rate limit exceeded${usage} ` +
        `reading ${path} (HTTP ${String(details.status)}); ` +
        `retry after ${new Date(resumeAt).toISOString()}`,
    );
    this.name = "GitHubRateLimitError";
    this.resumeAt = resumeAt;
  }
}

function rateLimitResumeAt(details: RateLimitDetails, now: number): number {
  if (details.retryAfterSeconds !== null)
    return now + details.retryAfterSeconds * 1000;
  return details.remaining === 0 && details.resetAt !== null
    ? Math.max(now, details.resetAt.getTime())
    : now + SECONDARY_LIMIT_BACKOFF_SECONDS * 1000;
}

function numberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The rate-limit failure a response represents, or null when it is some other
 * outcome. A 429 is always a rate limit; a 403 is one only when GitHub says so
 * (an exhausted bucket, a `retry-after`, or a rate-limit message), so a
 * missing permission still surfaces as an ordinary 403.
 */
export function rateLimitError(
  response: Response,
  body: string,
  path: string,
): GitHubRateLimitError | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const { headers } = response;
  const remaining = numberHeader(headers, "x-ratelimit-remaining");
  const retryAfterSeconds = numberHeader(headers, "retry-after");
  const signalled =
    remaining === 0 || retryAfterSeconds !== null || /rate limit/iu.test(body);
  if (!signalled && response.status === 403) {
    return null;
  }
  const reset = numberHeader(headers, "x-ratelimit-reset");
  return new GitHubRateLimitError(path, {
    status: response.status,
    resource: headers.get("x-ratelimit-resource"),
    limit: numberHeader(headers, "x-ratelimit-limit"),
    used: numberHeader(headers, "x-ratelimit-used"),
    remaining,
    resetAt: reset === null ? null : new Date(reset * 1000),
    retryAfterSeconds,
  });
}

const GraphqlErrorsSchema = z
  .array(z.object({ type: z.string() }).loose())
  .refine((errors) => errors.some((error) => error.type === "RATE_LIMITED"));

/**
 * GraphQL reports an exhausted bucket as HTTP 200 with `remaining: 0` or a
 * `RATE_LIMITED` error in the payload; recognise that shape too.
 */
export function graphqlRateLimitError(
  response: Response,
  errors: unknown,
  path: string,
): GitHubRateLimitError | null {
  const remaining = numberHeader(response.headers, "x-ratelimit-remaining");
  const limited =
    remaining === 0 || GraphqlErrorsSchema.safeParse(errors).success;
  if (!limited) return null;
  const reset = numberHeader(response.headers, "x-ratelimit-reset");
  return new GitHubRateLimitError(path, {
    status: response.status,
    resource: response.headers.get("x-ratelimit-resource") ?? "graphql",
    limit: numberHeader(response.headers, "x-ratelimit-limit"),
    used: numberHeader(response.headers, "x-ratelimit-used"),
    remaining,
    resetAt: reset === null ? null : new Date(reset * 1000),
    retryAfterSeconds: numberHeader(response.headers, "retry-after"),
  });
}

type CachedResponse = {
  etag: string;
  body: string;
  headers: [string, string][];
};

/**
 * A bounded least-recently-used map of ETagged GET responses. Entries are
 * keyed by a token fingerprint plus the full URL (query included), so two
 * identities never share a body and the token itself is never retained.
 */
export class ConditionalCache {
  readonly #entries = new Map<string, CachedResponse>();
  /** Requests answered by `304 Not Modified` (not charged to the bucket). */
  notModified = 0;
  /** Requests that returned a full, charged response. */
  fetched = 0;

  constructor(readonly maxEntries = 500) {}

  get(key: string): CachedResponse | undefined {
    const entry = this.#entries.get(key);
    if (entry !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: CachedResponse): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.maxEntries) break;
      this.#entries.delete(oldest);
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}

/**
 * Process-wide ETag cache for the shared paginated REST reads. The review gate
 * re-reads the same reviews, reactions, and comment pages every tick;
 * replaying the ETag turns each unchanged page into an uncharged 304.
 */
export const restCache = new ConditionalCache();

/** Response headers worth replaying from a cached body. */
const REPLAYED_HEADERS = ["content-type", "link", "etag"];

function cacheKey(token: string, url: string): string {
  const fingerprint = createHash("sha256").update(token).digest("hex");
  return `${fingerprint}\n${url}`;
}

export type GitHubGetOptions = {
  token: string;
  cache?: ConditionalCache;
  signal?: AbortSignal;
  redirect?: "error" | "follow" | "manual";
};

/** Re-wrap a consumed body so the caller can still read it. */
function rewrap(response: Response, body: string): Response {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Store an ETagged success and hand back a readable copy of its body. */
async function storeEtagged(
  response: Response,
  etag: string,
  key: string,
  cache: ConditionalCache,
): Promise<Response> {
  const body = await response.text();
  const replayed: [string, string][] = [];
  for (const name of REPLAYED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) {
      replayed.push([name, value]);
    }
  }
  cache.set(key, { etag, body, headers: replayed });
  return rewrap(response, body);
}

/**
 * GET a GitHub REST URL, revalidating a cached ETag when one is held.
 *
 * A `304` is answered from the cache as a synthetic `200`; a fresh `200`
 * with an `ETag` is stored. Rate-limit responses throw
 * {@link GitHubRateLimitError}; every other status is returned unchanged so
 * callers keep their own 404 tolerance and error wording.
 */
export async function githubGet(
  url: string | URL,
  options: GitHubGetOptions,
): Promise<Response> {
  const { cache, token, signal, redirect } = options;
  const href = url.toString();
  const key = cache === undefined ? null : cacheKey(token, href);
  const cached = key === null ? undefined : cache?.get(key);
  const headers = githubHeaders(token);
  if (cached !== undefined) {
    headers["If-None-Match"] = cached.etag;
  }
  const response = await fetch(url, {
    headers,
    ...(redirect === undefined ? {} : { redirect }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (cached !== undefined && response.status === 304) {
    if (cache !== undefined) {
      cache.notModified++;
    }
    return new Response(cached.body, { status: 200, headers: cached.headers });
  }
  if (cache !== undefined) {
    cache.fetched++;
  }
  if (response.status === 403 || response.status === 429) {
    const body = await response.text();
    throwIfRateLimited(response, body, new URL(href).pathname);
    return rewrap(response, body);
  }
  const etag = response.headers.get("etag");
  return cache === undefined || key === null || etag === null || !response.ok
    ? response
    : storeEtagged(response, etag, key, cache);
}

/**
 * Throw the typed rate-limit error for a non-GET response (POST, GraphQL)
 * when GitHub reports one; otherwise return so the caller reports its own
 * failure. GraphQL draws on a separate bucket but reports the same shape.
 */
export function throwIfRateLimited(
  response: Response,
  body: string,
  path: string,
): void {
  const limited = rateLimitError(response, body, path);
  if (limited !== null) throw limited;
}
