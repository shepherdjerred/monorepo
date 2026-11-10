import type { HistoryIndex } from "#lib/history/index.ts";
import { ftsQuery, parseSince } from "#lib/history/query/query.ts";
import { publicRecord } from "#lib/history/query/results.ts";
import {
  HistorySourceNameSchema,
  type HistoryMessage,
  type HistoryRecord,
  type HistorySourceName,
  type HistoryWarning,
} from "#lib/history/types.ts";
import {
  HISTORY_API_VERSION,
  HistoryApiErrorSchema,
  HistoryApiFacetsResponseSchema,
  HistoryApiSessionDetailResponseSchema,
  HistoryApiSessionsResponseSchema,
  HistoryApiToolsResponseSchema,
  HistoryApiUsageGroupSchema,
  HistoryApiUsageResponseSchema,
} from "./schema.ts";

export type HistoryApiDependencies = {
  readonly index: HistoryIndex;
  /** Re-reads full transcripts; `targetedMessages` in production. */
  readonly readMessages: (records: readonly HistoryRecord[]) => Promise<{
    readonly messages: ReadonlyMap<string, readonly HistoryMessage[]>;
    readonly warnings: readonly HistoryWarning[];
  }>;
};

/** A request the client got wrong; answered with HTTP 400. */
class BadRequest extends Error {}

class NotFound extends Error {}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 500;
const DEFAULT_MESSAGE_PAGE = 500;
const MAX_MESSAGE_PAGE = 5000;

type IntParamSpec = {
  readonly name: string;
  readonly fallback: number;
  readonly max: number;
  readonly min?: number;
};

function intParam(
  params: URLSearchParams,
  { name, fallback, max, min = 0 }: IntParamSpec,
): number {
  const raw = params.get(name);
  if (raw === null) {
    return fallback;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new BadRequest(`${name} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequest(
      `${name} must be from ${String(min)} to ${String(max)}`,
    );
  }
  return value;
}

/** Absent means no lower bound; otherwise the CLI's `--since` grammar. */
function sinceParam(params: URLSearchParams): string | null {
  const raw = params.get("since");
  if (raw === null) {
    return null;
  }
  try {
    return parseSince(raw);
  } catch (error: unknown) {
    throw new BadRequest(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function sourceParam(params: URLSearchParams): HistorySourceName | null {
  const raw = params.get("source");
  if (raw === null) {
    return null;
  }
  const parsed = HistorySourceNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequest(`Unknown history source "${raw}"`);
  }
  return parsed.data;
}

function listSessions(index: HistoryIndex, params: URLSearchParams): Response {
  const limit = intParam(params, {
    name: "limit",
    fallback: DEFAULT_PAGE,
    max: MAX_PAGE,
    min: 1,
  });
  const offset = intParam(params, {
    name: "offset",
    fallback: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  const page = index.sessions({
    since: sinceParam(params),
    source: sourceParam(params),
    machine: params.get("machine"),
    workspace: params.get("workspace"),
    limit,
    offset,
  });
  return Response.json(
    HistoryApiSessionsResponseSchema.parse({
      apiVersion: HISTORY_API_VERSION,
      query: null,
      ...page,
    }),
  );
}

function searchSessions(
  index: HistoryIndex,
  params: URLSearchParams,
): Response {
  const query = (params.get("q") ?? "").trim();
  try {
    ftsQuery(query);
  } catch (error: unknown) {
    throw new BadRequest(
      error instanceof Error ? error.message : String(error),
    );
  }
  const limit = intParam(params, {
    name: "limit",
    fallback: DEFAULT_PAGE,
    max: MAX_PAGE,
    min: 1,
  });
  const offset = intParam(params, {
    name: "offset",
    fallback: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  const { ids, hasMore } = index.readSnapshot(() => {
    const records = index.search(query, {
      since: sinceParam(params),
      source: sourceParam(params),
      machine: params.get("machine"),
      workspace: params.get("workspace"),
      limit: limit + 1,
      offset,
    });
    return {
      ids: records.slice(0, limit).map((record) => record.id),
      hasMore: records.length > limit,
    };
  });
  return Response.json(
    HistoryApiSessionsResponseSchema.parse({
      apiVersion: HISTORY_API_VERSION,
      query,
      sessions: index.sessionsByIds(ids),
      hasMore,
    }),
  );
}

async function sessionDetail(
  dependencies: HistoryApiDependencies,
  id: number,
  params: URLSearchParams,
): Promise<Response> {
  const { index } = dependencies;
  const offset = intParam(params, {
    name: "offset",
    fallback: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  const limit = intParam(params, {
    name: "limit",
    fallback: DEFAULT_MESSAGE_PAGE,
    max: MAX_MESSAGE_PAGE,
    min: 1,
  });
  const record = index.record(id);
  const session = index.sessionsByIds([id])[0];
  if (record === null || session === undefined) {
    throw new NotFound(
      `History record ${String(id)} no longer exists; local ids change after a rebuild.`,
    );
  }
  const targeted = await dependencies.readMessages([publicRecord(record)]);
  if (targeted.warnings.length > 0) {
    throw new NotFound(
      targeted.warnings.map((warning) => warning.message).join("; "),
    );
  }
  const all =
    targeted.messages.get(`${record.source}:${record.sourceId}`) ?? [];
  return Response.json(
    HistoryApiSessionDetailResponseSchema.parse({
      apiVersion: HISTORY_API_VERSION,
      session,
      messages: all.slice(offset, offset + limit).map((entry) => ({
        role: entry.role,
        text: entry.text,
        createdAt: entry.createdAt,
        toolName: entry.toolName ?? null,
      })),
      offset,
      totalMessages: all.length,
    }),
  );
}

function usage(index: HistoryIndex, params: URLSearchParams): Response {
  const groupBy = HistoryApiUsageGroupSchema.safeParse(
    params.get("groupBy") ?? "day",
  );
  if (!groupBy.success) {
    throw new BadRequest(
      "groupBy must be one of day, source, model, workspace, machine",
    );
  }
  return Response.json(
    HistoryApiUsageResponseSchema.parse(
      index.usageGroups({
        groupBy: groupBy.data,
        since: sinceParam(params),
        source: sourceParam(params),
      }),
    ),
  );
}

function tools(index: HistoryIndex, params: URLSearchParams): Response {
  return Response.json(
    HistoryApiToolsResponseSchema.parse(
      index.tools({
        since: sinceParam(params),
        limit: intParam(params, {
          name: "limit",
          fallback: 50,
          max: 500,
          min: 1,
        }),
      }),
    ),
  );
}

function facets(index: HistoryIndex): Response {
  return Response.json(HistoryApiFacetsResponseSchema.parse(index.facets()));
}

const ROUTES = new Map<
  string,
  (index: HistoryIndex, params: URLSearchParams) => Response
>([
  ["/v1/sessions", listSessions],
  ["/v1/search", searchSessions],
  ["/v1/usage", usage],
  ["/v1/tools", tools],
  ["/v1/facets", facets],
]);

function errorResponse(message: string, status: number): Response {
  return Response.json(HistoryApiErrorSchema.parse({ error: message }), {
    status,
  });
}

/**
 * Serves the read-only `/v1/*` API. Returns null for any other path so the
 * daemon's control endpoints keep their own routing. Every response body is
 * validated against its contract before it leaves.
 */
export async function handleHistoryApiRequest(
  dependencies: HistoryApiDependencies,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/")) {
    return null;
  }
  if (request.method !== "GET") {
    return errorResponse("Only GET is supported", 405);
  }
  const params = url.searchParams;
  try {
    const route = ROUTES.get(url.pathname);
    if (route !== undefined) {
      return route(dependencies.index, params);
    }
    const detail = /^\/v1\/sessions\/([1-9]\d*)$/u.exec(url.pathname);
    return detail === null
      ? errorResponse("Not found", 404)
      : await sessionDetail(dependencies, Number(detail[1]), params);
  } catch (error: unknown) {
    if (error instanceof BadRequest) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof NotFound) {
      return errorResponse(error.message, 404);
    }
    throw error;
  }
}
