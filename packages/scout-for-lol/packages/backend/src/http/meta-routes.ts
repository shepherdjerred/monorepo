import {
  lookupChampion,
  lookupMatchup,
  lookupTiers,
  parseMetaSelection,
  type MetaErrorCode,
  type MetaFailure,
  type MetaSelection,
} from "#src/meta/meta-query.ts";
import type { MetaReader } from "#src/meta/meta-reader.ts";
import { META_SERVING_VERSION } from "@scout-for-lol/data/meta/meta-serving.ts";

/**
 * The public champion meta API: `GET /api/meta/v1/{manifest,tiers,champions/:id,matchups/:a/:b}`.
 *
 * Unauthenticated and read-only. It serves the roll-up's JSON for the
 * published lake build and nothing else; it never queries the lake or the
 * database. Every response states its patch, queue, bracket and sample size
 * (the slice `context` and `sample`/`games` fields), and carries an `ETag`
 * derived from the build and the request so a CDN or browser revalidates for
 * a 304 instead of re-downloading. Callers are rate-limited per IP.
 *
 * Lives outside `server.ts` for the same reason as the health probes: that
 * module binds a port on import.
 */

export const META_ROUTE_PREFIX = "/api/meta/v1/";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

const STATUS_BY_CODE: Record<MetaErrorCode, number> = {
  invalid_selection: 400,
  unknown_champion: 404,
  slice_not_found: 404,
  matchup_not_found: 404,
  meta_unavailable: 503,
};

export type MetaRateLimiter = {
  /** Charge one request to `callerKey`; `retryAfterSeconds` when refused. */
  check: (callerKey: string) => { allowed: true } | RateRefusal;
  reset: () => void;
};
type RateRefusal = { allowed: false; retryAfterSeconds: number };

export const META_RATE_LIMIT = {
  windowMs: 60_000,
  perCallerMax: 120,
  globalMax: 6000,
  maxTrackedCallers: 5000,
} as const;

/**
 * Fixed-window limiter, per caller first and a global cap on top: the same
 * pattern as the telemetry router's. A refused caller is never charged to the
 * global counter, so one noisy IP cannot starve everyone else.
 */
export function createMetaRateLimiter(
  options: {
    windowMs?: number;
    perCallerMax?: number;
    globalMax?: number;
    maxTrackedCallers?: number;
    now?: () => number;
  } = {},
): MetaRateLimiter {
  const windowMs = options.windowMs ?? META_RATE_LIMIT.windowMs;
  const perCallerMax = options.perCallerMax ?? META_RATE_LIMIT.perCallerMax;
  const globalMax = options.globalMax ?? META_RATE_LIMIT.globalMax;
  const maxTracked =
    options.maxTrackedCallers ?? META_RATE_LIMIT.maxTrackedCallers;
  const now = options.now ?? Date.now;
  let windowStartedAt = now();
  let inWindow = 0;
  const byCaller = new Map<string, number>();

  return {
    check: (callerKey) => {
      const current = now();
      if (current - windowStartedAt >= windowMs) {
        windowStartedAt = current;
        inWindow = 0;
        byCaller.clear();
      }
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStartedAt + windowMs - current) / 1000),
      );
      const forCaller = (byCaller.get(callerKey) ?? 0) + 1;
      if (forCaller > perCallerMax || inWindow + 1 > globalMax) {
        return { allowed: false, retryAfterSeconds };
      }
      inWindow += 1;
      if (forCaller > 1 || byCaller.size < maxTracked) {
        byCaller.set(callerKey, forCaller);
      }
      return { allowed: true };
    },
    reset: () => {
      windowStartedAt = now();
      inWindow = 0;
      byCaller.clear();
    },
  };
}

export function clientKey(request: Request): string {
  const forwarded = request.headers
    .get("X-Forwarded-For")
    ?.split(",")[0]
    ?.trim();
  const ip = request.headers.get("CF-Connecting-IP") ?? forwarded;
  return `ip:${ip === undefined || ip === "" ? "unknown" : ip}`;
}

type MetaRouteDeps = {
  reader: MetaReader;
  limiter: MetaRateLimiter;
  cors?: Record<string, string>;
};

function baseHeaders(deps: MetaRouteDeps): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    ...deps.cors,
  };
}

type ErrorSpec = {
  status: number;
  code: string;
  message: string;
  headers?: Record<string, string>;
};

function errorResponse(deps: MetaRouteDeps, spec: ErrorSpec): Response {
  return Response.json(
    { error: { code: spec.code, message: spec.message } },
    {
      status: spec.status,
      headers: {
        "Cache-Control": "no-store",
        ...baseHeaders(deps),
        ...spec.headers,
      },
    },
  );
}

function failureResponse(deps: MetaRouteDeps, failed: MetaFailure): Response {
  return errorResponse(deps, {
    status: STATUS_BY_CODE[failed.code],
    code: failed.code,
    message: failed.message,
    headers: failed.code === "meta_unavailable" ? { "Retry-After": "300" } : {},
  });
}

/** A response whose ETag names the build and the exact request. */
function cachedJson(
  request: Request,
  deps: MetaRouteDeps,
  buildId: string,
  body: unknown,
): Response {
  const identity = `${buildId}:${request.method === "HEAD" ? "GET" : request.method}:${new URL(request.url).pathname}?${[
    ...new URL(request.url).searchParams,
  ]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&")}`;
  const etag = `W/"meta${META_SERVING_VERSION.toString()}-${Bun.hash(identity).toString(36)}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": CACHE_CONTROL,
    ...baseHeaders(deps),
  };
  const candidates = request.headers
    .get("If-None-Match")
    ?.split(",")
    .map((value) => value.trim());
  if (
    candidates?.includes(etag) === true ||
    candidates?.includes("*") === true
  ) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function selectionOf(url: URL): ReturnType<typeof parseMetaSelection> {
  return parseMetaSelection({
    patch: url.searchParams.get("patch"),
    queue: url.searchParams.get("queue"),
    bracket: url.searchParams.get("bracket"),
    role: url.searchParams.get("role"),
  });
}

const NOT_A_CHAMPION_ID: ErrorSpec = {
  status: 404,
  code: "unknown_champion",
  message: "Champion ids are numeric Riot champion ids",
};

const CHAMPION_PATH = /^champions\/([^/]+)$/u;
const MATCHUP_PATH = /^matchups\/([^/]+)\/([^/]+)$/u;

function championIdOf(text: string | undefined): number | undefined {
  return text !== undefined && /^\d{1,6}$/u.test(text)
    ? Number(text)
    : undefined;
}

/** Null when the path is not a meta route. */
export async function handleMetaRoute(
  request: Request,
  url: URL,
  deps: MetaRouteDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith(META_ROUTE_PREFIX)) return null;
  const route = url.pathname.slice(META_ROUTE_PREFIX.length);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(deps, {
      status: 405,
      code: "method_not_allowed",
      message: "The meta API is read-only: use GET",
      headers: { Allow: "GET, HEAD" },
    });
  }
  const limited = deps.limiter.check(clientKey(request));
  if (!limited.allowed) {
    return errorResponse(deps, {
      status: 429,
      code: "rate_limited",
      message: "Too many requests; retry after the interval in Retry-After",
      headers: { "Retry-After": limited.retryAfterSeconds.toString() },
    });
  }

  if (route === "manifest") {
    const manifest = await deps.reader.manifest();
    if (manifest === undefined) {
      return failureResponse(deps, {
        ok: false,
        code: "meta_unavailable",
        message: "Champion meta has not been published yet",
      });
    }
    return cachedJson(request, deps, manifest.buildId, manifest);
  }

  const selection = selectionOf(url);
  if (route === "tiers") {
    return await respond(selection, request, deps, async (chosen) => {
      const result = await lookupTiers(deps.reader, chosen);
      return result.ok
        ? {
            ok: true,
            buildId: result.value.file.buildId,
            body: result.value.file,
          }
        : result;
    });
  }

  const champion = CHAMPION_PATH.exec(route);
  if (champion !== null) {
    const championId = championIdOf(champion[1]);
    if (championId === undefined) {
      return errorResponse(deps, NOT_A_CHAMPION_ID);
    }
    return await respond(selection, request, deps, async (chosen) => {
      const result = await lookupChampion(deps.reader, championId, chosen);
      if (!result.ok) return result;
      const { value } = result;
      return {
        ok: true,
        buildId: value.buildId,
        body: {
          schemaVersion: META_SERVING_VERSION,
          buildId: value.buildId,
          championId: value.championId,
          championName: value.championName,
          context: value.context,
          slices: value.slices,
        },
      };
    });
  }

  const matchup = MATCHUP_PATH.exec(route);
  if (matchup !== null) {
    const first = championIdOf(matchup[1]);
    const second = championIdOf(matchup[2]);
    if (first === undefined || second === undefined) {
      return errorResponse(deps, NOT_A_CHAMPION_ID);
    }
    return await respond(selection, request, deps, async (chosen) => {
      const result = await lookupMatchup(deps.reader, first, second, chosen);
      return result.ok
        ? {
            ok: true,
            buildId: result.value.buildId,
            body: { schemaVersion: META_SERVING_VERSION, ...result.value },
          }
        : result;
    });
  }

  return errorResponse(deps, {
    status: 404,
    code: "not_found",
    message: `No meta route ${route}`,
  });
}

async function respond(
  selection: ReturnType<typeof parseMetaSelection>,
  request: Request,
  deps: MetaRouteDeps,
  read: (
    selection: MetaSelection,
  ) => Promise<{ ok: true; buildId: string; body: unknown } | MetaFailure>,
): Promise<Response> {
  if (!selection.ok) return failureResponse(deps, selection);
  const result = await read(selection.value);
  return result.ok
    ? cachedJson(request, deps, result.buildId, result.body)
    : failureResponse(deps, result);
}
