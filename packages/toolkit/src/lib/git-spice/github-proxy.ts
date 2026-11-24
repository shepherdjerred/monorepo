import { z } from "zod";
import {
  isRepoSyncCommand,
  parseGitSpiceArgs,
  shouldSkipGitSpiceToken,
} from "./spice-args.ts";
import { findBranchesByPrGqlIds, readGitConfig } from "./spice-state.ts";

const DEFAULT_UPSTREAM_BASE_URL = "https://api.github.com";
const DEFAULT_RETRY_DELAYS_MS = [300, 1000] as const;
const GRAPHQL_NODES_BATCH_LIMIT = 100;
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);
const HOP_BY_HOP_REQUEST_HEADERS = new Set(
  "connection content-length host keep-alive transfer-encoding".split(" "),
);
const STRIPPED_RESPONSE_HEADERS = new Set(
  "connection content-encoding content-length keep-alive transfer-encoding".split(
    " ",
  ),
);
const TRANSIENT_ERROR_PATTERNS = [
  "econnreset",
  "connection reset",
  "etimedout",
  "eai_again",
  "socket connection was closed",
] as const;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type GitHubProxyState = {
  batchFailed: boolean;
  readonly missingGqlIds: Set<string>;
};
export type StartGitHubProxyOptions = {
  readonly upstreamBaseUrl?: string | undefined;
  readonly fetchImpl?: FetchLike | undefined;
  readonly retryDelaysMs?: readonly number[] | undefined;
  readonly sleepImpl?: ((ms: number) => Promise<void>) | undefined;
};
export type StartedGitHubProxy = {
  readonly url: string;
  readonly port: number;
  readonly state: GitHubProxyState;
  readonly stop: () => Promise<void>;
};

const ErrorShapeSchema = z.looseObject({
  name: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  cause: z.unknown().optional(),
});
const GraphqlRequestSchema = z.looseObject({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()).optional(),
});
const NodesVariablesSchema = z.looseObject({ ids: z.array(z.string()).min(1) });
const GraphqlErrorEntrySchema = z.looseObject({
  type: z.string().optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  message: z.string().optional(),
});
const GraphqlNodesResponseSchema = z.looseObject({
  data: z
    .looseObject({ nodes: z.array(z.unknown()) })
    .nullable()
    .optional(),
  errors: z.array(GraphqlErrorEntrySchema).optional(),
});

function collectErrorStrings(error: unknown, depth = 0): string[] {
  if (error == null || depth > 4) return [];
  if (typeof error === "string") return [error];
  const parsed = ErrorShapeSchema.safeParse(error);
  if (!parsed.success) return [];
  const { name, message, code, cause } = parsed.data;
  const parts = [name, message, code].filter((p) => p !== undefined);
  return [...parts, ...collectErrorStrings(cause, depth + 1)];
}

export function isTransientUpstreamError(error: unknown): boolean {
  const combined = collectErrorStrings(error).join(" ").toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => combined.includes(p));
}

export function stripGraphqlCommentsAndWhitespace(query: string): string {
  return query.replace(/^(?:\s|#[^\r\n]*(?:\r?\n|$))+/u, "").trimStart();
}

export function isReadOnlyGraphqlQuery(query: string): boolean {
  const s = stripGraphqlCommentsAndWhitespace(query);
  return s.startsWith("{") || (s.startsWith("query") && !/^query\w/u.test(s));
}

function copyFilteredHeaders(
  incoming: Headers,
  excluded: ReadonlySet<string>,
): Headers {
  const headers = new Headers();
  incoming.forEach((value, key) => {
    if (!excluded.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

function resolveUpstreamUrl(requestUrl: URL, upstreamBaseUrl: string): string {
  const base = upstreamBaseUrl.replace(/\/+$/u, "");
  const { pathname: p, search: q } = requestUrl;
  if (p === "/graphql") return `${base}/graphql${q}`;
  if (p === "/v3" || p.startsWith("/v3/"))
    return `${base}${p.slice(3) || "/"}${q}`;
  return p === "/api/v3" || p.startsWith("/api/v3/")
    ? `${base}${p.slice(7) || "/"}${q}`
    : `${base}${p}${q}`;
}

type DispatchCtx = {
  readonly targetUrl: string;
  readonly headers: Headers;
  readonly state: GitHubProxyState;
  readonly fetchImpl: FetchLike;
  readonly retryDelaysMs: readonly number[];
  readonly sleepImpl: (ms: number) => Promise<void>;
};

async function fetchWithReadRetry(
  ctx: DispatchCtx,
  method: string,
  body: Uint8Array | undefined,
  readOnly: boolean,
): Promise<Response> {
  const maxAttempts = readOnly ? ctx.retryDelaysMs.length + 1 : 1;
  const includeBody =
    body !== undefined && method !== "GET" && method !== "HEAD";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await ctx.fetchImpl(ctx.targetUrl, {
        method,
        headers: ctx.headers,
        ...(includeBody ? { body } : {}),
        redirect: "manual",
      });
      if (
        readOnly &&
        attempt + 1 < maxAttempts &&
        RETRYABLE_HTTP_STATUSES.has(res.status)
      ) {
        await res.arrayBuffer().catch(() => null);
        await ctx.sleepImpl(ctx.retryDelaysMs[attempt] ?? 0);
        continue;
      }
      return res;
    } catch (error) {
      if (
        readOnly &&
        attempt + 1 < maxAttempts &&
        isTransientUpstreamError(error)
      ) {
        await ctx.sleepImpl(ctx.retryDelaysMs[attempt] ?? 0);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Upstream request exhausted retry attempts");
}

async function rebuildResponse(upstream: Response): Promise<Response> {
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyFilteredHeaders(upstream.headers, STRIPPED_RESPONSE_HEADERS),
  });
}

function extractNodesQueryIds(
  query: string,
  variables: Record<string, unknown> | undefined,
): readonly string[] | null {
  if (!/\bnodes\s*\(\s*ids\s*:/u.test(query) || !isReadOnlyGraphqlQuery(query))
    return null;
  const parsed = NodesVariablesSchema.safeParse(variables);
  return parsed.success ? parsed.data.ids : null;
}

function processNodesChunkJson(params: {
  readonly parsedJson: unknown;
  readonly batchIds: readonly string[];
  readonly state: GitHubProxyState;
  readonly status: number;
  readonly headers: Headers;
}):
  | { ok: true; nodes: unknown[]; dataFields: Record<string, unknown> }
  | { ok: false; response: Response } {
  const { parsedJson, batchIds, state, status, headers } = params;
  const parsed = GraphqlNodesResponseSchema.safeParse(parsedJson);
  if (!parsed.success || parsed.data.data == null) {
    state.batchFailed = true;
    return {
      ok: false,
      response: Response.json(parsedJson, { status, headers }),
    };
  }
  const chunkNodes = [...parsed.data.data.nodes];
  const remainingErrors: unknown[] = [];
  for (const err of parsed.data.errors ?? []) {
    const p = err.path;
    const idx =
      err.type === "NOT_FOUND" &&
      p?.length === 2 &&
      p[0] === "nodes" &&
      typeof p[1] === "number"
        ? p[1]
        : undefined;
    const missingId = idx === undefined ? undefined : batchIds[idx];
    if (idx === undefined || missingId === undefined) {
      remainingErrors.push(err);
    } else {
      state.missingGqlIds.add(missingId);
      chunkNodes[idx] ??= { state: "OPEN", headRefOid: "" };
    }
  }
  if (remainingErrors.length > 0 || chunkNodes.length !== batchIds.length) {
    state.batchFailed = true;
    const body =
      remainingErrors.length > 0
        ? {
            ...parsed.data,
            data: { ...parsed.data.data, nodes: chunkNodes },
            errors: remainingErrors,
          }
        : parsedJson;
    return { ok: false, response: Response.json(body, { status, headers }) };
  }
  return { ok: true, nodes: chunkNodes, dataFields: parsed.data.data };
}

async function handleNodesGraphqlQuery(
  rawEnvelope: z.infer<typeof GraphqlRequestSchema>,
  ids: readonly string[],
  ctx: DispatchCtx,
): Promise<Response> {
  const combinedNodes: unknown[] = [];
  let lastDataFields: Record<string, unknown> = {};
  let lastHeaders = new Headers({ "content-type": "application/json" });

  for (let i = 0; i < ids.length; i += GRAPHQL_NODES_BATCH_LIMIT) {
    const batchIds = ids.slice(i, i + GRAPHQL_NODES_BATCH_LIMIT);
    const bodyJson = JSON.stringify({
      ...rawEnvelope,
      variables: { ...rawEnvelope.variables, ids: batchIds },
    });
    let upstream: Response;
    try {
      upstream = await fetchWithReadRetry(
        ctx,
        "POST",
        new TextEncoder().encode(bodyJson),
        true,
      );
    } catch {
      ctx.state.batchFailed = true;
      return Response.json(
        { errors: [{ message: "Upstream GitHub GraphQL request failed" }] },
        { status: 502 },
      );
    }
    lastHeaders = copyFilteredHeaders(
      upstream.headers,
      STRIPPED_RESPONSE_HEADERS,
    );
    if (!upstream.ok) {
      ctx.state.batchFailed = true;
      return rebuildResponse(upstream);
    }
    const rawText = await upstream.text();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      ctx.state.batchFailed = true;
      return new Response(rawText, {
        status: upstream.status,
        headers: lastHeaders,
      });
    }
    const processed = processNodesChunkJson({
      parsedJson,
      batchIds,
      state: ctx.state,
      status: upstream.status,
      headers: lastHeaders,
    });
    if (!processed.ok) return processed.response;
    lastDataFields = processed.dataFields;
    combinedNodes.push(...processed.nodes);
  }
  return Response.json(
    { data: { ...lastDataFields, nodes: combinedNodes } },
    { status: 200, headers: lastHeaders },
  );
}

async function handleGraphqlPost(
  bodyBuffer: Uint8Array,
  ctx: DispatchCtx,
): Promise<Response | null> {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(bodyBuffer));
  } catch {
    return null;
  }
  const gqlRequest = GraphqlRequestSchema.safeParse(parsedBody);
  if (!gqlRequest.success) return null;
  const nodesIds = extractNodesQueryIds(
    gqlRequest.data.query,
    gqlRequest.data.variables,
  );
  if (nodesIds !== null)
    return handleNodesGraphqlQuery(gqlRequest.data, nodesIds, ctx);
  try {
    const ro = isReadOnlyGraphqlQuery(gqlRequest.data.query);
    return await rebuildResponse(
      await fetchWithReadRetry(ctx, "POST", bodyBuffer, ro),
    );
  } catch {
    return Response.json(
      { errors: [{ message: "Upstream GitHub GraphQL request failed" }] },
      { status: 502 },
    );
  }
}

export function startGitHubProxy(
  options: StartGitHubProxyOptions = {},
): StartedGitHubProxy {
  const upstreamBaseUrl = options.upstreamBaseUrl ?? DEFAULT_UPSTREAM_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => Bun.sleep(ms));
  const state: GitHubProxyState = {
    batchFailed: false,
    missingGqlIds: new Set<string>(),
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request: Request): Promise<Response> {
      const requestUrl = new URL(request.url);
      const method = request.method.toUpperCase();
      const isRead = method === "GET" || method === "HEAD";
      const body = isRead
        ? undefined
        : new Uint8Array(await request.arrayBuffer());
      const ctx: DispatchCtx = {
        targetUrl: resolveUpstreamUrl(requestUrl, upstreamBaseUrl),
        headers: copyFilteredHeaders(
          request.headers,
          HOP_BY_HOP_REQUEST_HEADERS,
        ),
        state,
        fetchImpl,
        retryDelaysMs,
        sleepImpl,
      };
      if (
        method === "POST" &&
        body !== undefined &&
        requestUrl.pathname === "/graphql"
      ) {
        const gqlResponse = await handleGraphqlPost(body, ctx);
        if (gqlResponse !== null) return gqlResponse;
      }
      try {
        return await rebuildResponse(
          await fetchWithReadRetry(ctx, method, body, isRead),
        );
      } catch {
        return Response.json(
          { message: "Upstream GitHub REST request failed" },
          { status: 502 },
        );
      }
    },
  });

  const port = server.port;
  if (port === undefined) {
    void server.stop(true);
    throw new Error("Failed to bind ephemeral GitHub proxy port");
  }
  return {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    state,
    stop: async () => {
      await server.stop(true);
    },
  };
}

export async function shouldStartGitHubProxy(
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<boolean> {
  if (shouldSkipGitSpiceToken(args)) return false;
  const parsed = parseGitSpiceArgs(args, cwd);
  if (parsed.hasGithubApiUrlFlag) return false;
  const explicit = env["GITHUB_API_URL"]?.trim();
  return (
    (explicit === undefined || explicit.length === 0) &&
    (await readGitConfig(parsed.cwd, "spice.forge.github.apiUrl", env)) === null
  );
}

export async function finalizeGitHubProxyOutcome(options: {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exitCode: number;
  readonly state: GitHubProxyState;
  readonly writeStderr?: ((line: string) => void) | undefined;
}): Promise<number> {
  const { args, cwd, env, exitCode, state } = options;
  const writeStderr =
    options.writeStderr ??
    ((line: string) => {
      console.error(line);
    });
  if (state.missingGqlIds.size > 0) {
    for (const m of await findBranchesByPrGqlIds(
      cwd,
      state.missingGqlIds,
      env,
    )) {
      const prLabel =
        m.prNumber === undefined
          ? `(${m.gqlId})`
          : `PR #${String(m.prNumber)} (${m.gqlId})`;
      writeStderr(
        m.branch === undefined
          ? `toolkit git-spice: tracked PR node ${m.gqlId} was not found on GitHub. Run: toolkit spice branch untrack <branch>`
          : `toolkit git-spice: tracked ${prLabel} on branch '${m.branch}' was not found on GitHub; kept local branch untouched. Run: toolkit spice branch untrack ${m.branch}`,
      );
    }
  }
  return exitCode === 0 &&
    isRepoSyncCommand(args) &&
    (state.batchFailed || state.missingGqlIds.size > 0)
    ? 1
    : exitCode;
}

export async function withGitHubProxy(
  context: {
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly writeStderr?: ((line: string) => void) | undefined;
  },
  callback: (
    env: Record<string, string | undefined>,
    state: GitHubProxyState | null,
  ) => Promise<number>,
  proxyOptions: StartGitHubProxyOptions = {},
): Promise<number> {
  const parsedCwd = parseGitSpiceArgs(context.args, context.cwd).cwd;
  if (!(await shouldStartGitHubProxy(context.args, parsedCwd, context.env))) {
    return callback({ ...context.env }, null);
  }
  const proxy = startGitHubProxy(proxyOptions);
  let exitCode: number;
  try {
    exitCode = await callback(
      { ...context.env, GITHUB_API_URL: proxy.url },
      proxy.state,
    );
  } finally {
    await proxy.stop();
  }
  return finalizeGitHubProxyOutcome({
    ...context,
    cwd: parsedCwd,
    exitCode,
    state: proxy.state,
  });
}
