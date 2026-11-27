import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import {
  ArchiveStatusSchema,
  CoreId,
  MacBookPublicationSchema,
  PriorityDeleteSchema,
  PriorityImportSchema,
  PriorityPutSchema,
  TerminalId,
} from "./contract.ts";
import type { ArchiveStatus, MacBookPublication } from "./contract.ts";
import { cocoaSeconds } from "./store.ts";
import type { BrimStore } from "./store.ts";

const MAX_PUBLICATION_BYTES = 32 * 1024 * 1024;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_PRIORITY_BYTES = 4 * 1024;
const CLOCK_SKEW_SECONDS = 60;
const VERSION = 1;
const NO_STORE = { "Cache-Control": "no-store" };

type Scope = "hub" | "device" | "macbook" | "scheduler";
type Tokens = Readonly<Record<Scope, string>>;
type Options = Readonly<{
  store: BrimStore;
  tokens: Tokens;
  history: (request: Request) => Response | null | Promise<Response | null>;
  archiveStatus: () => ArchiveStatus | Promise<ArchiveStatus>;
  syncArchive: () => Promise<ArchiveStatus>;
  now?: () => Date;
}>;
type Route = Readonly<{
  scopes: readonly Scope[];
  handle: (request: Request, url: URL) => Response | Promise<Response>;
}>;

class BadRequest extends Error {
  constructor(
    message: string,
    readonly status = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function api(body: object, status = 200): Response {
  return Response.json(
    { version: VERSION, ...body },
    { status, headers: NO_STORE },
  );
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function authorize(tokens: Tokens) {
  const scopes: readonly Scope[] = ["hub", "device", "macbook", "scheduler"];
  const values = scopes.map((scope) => tokens[scope]);
  if (
    values.some((token) => !/^\S{1,512}$/u.test(token)) ||
    new Set(values).size !== scopes.length
  ) {
    throw new Error("Brim bearer credentials must be present and distinct");
  }
  const hashes = new Map(scopes.map((scope) => [scope, digest(tokens[scope])]));
  return (request: Request): Scope | undefined => {
    const token = /^Bearer (\S{1,512})$/iu.exec(
      request.headers.get("Authorization") ?? "",
    )?.[1];
    if (token === undefined) return;
    const candidate = digest(token);
    for (const [scope, expected] of hashes) {
      if (timingSafeEqual(candidate, expected)) return scope;
    }
    return undefined;
  };
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const stream = request.body;
  if (stream === null) throw new BadRequest("A JSON request body is required");
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let content = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const bytes: unknown = part.value;
      if (!(bytes instanceof Uint8Array))
        throw new BadRequest("Expected a byte stream");
      totalBytes += bytes.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new BadRequest("Request body is too large", 413);
      }
      content += decoder.decode(bytes, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content);
  } catch (error: unknown) {
    if (error instanceof BadRequest) throw error;
    throw new BadRequest("Request body is not valid JSON", 400, {
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }
}

async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number,
): Promise<T> {
  const result = schema.safeParse(await readJson(request, maxBytes));
  if (!result.success)
    throw new BadRequest("Request body does not match the Brim contract");
  return result.data;
}

function unauthenticated(scope: Scope | undefined): Response {
  if (scope !== undefined)
    return api({ error: "Credential is not authorized for this action" }, 403);
  return Response.json(
    { version: VERSION, error: "Brim bearer credential required" },
    {
      status: 401,
      headers: { ...NO_STORE, "WWW-Authenticate": 'Bearer realm="Brim"' },
    },
  );
}

function validatePublicationTime(
  publication: MacBookPublication,
  now: Date,
): void {
  const latestObservation = publication.collectedAt + CLOCK_SKEW_SECONDS;
  const future = (reading: {
    snapshot?: { sourceTimestamp: number } | undefined;
  }) =>
    reading.snapshot !== undefined &&
    reading.snapshot.sourceTimestamp > latestObservation;
  if (
    publication.collectedAt > cocoaSeconds(now) + CLOCK_SKEW_SECONDS ||
    publication.quotas.some((reading) => future(reading)) ||
    publication.billing.some((reading) => future(reading)) ||
    publication.quotaHistory.some(
      ({ recordedAt }) => recordedAt > latestObservation,
    )
  )
    throw new BadRequest("Collector timestamps are ahead of the service clock");
}

async function handlePriority(
  request: Request,
  { identity, scope }: { identity: RegExpExecArray; scope: Scope | undefined },
  store: BrimStore,
  now: Date,
): Promise<Response> {
  const method = request.method;
  if (
    method === "GET"
      ? scope !== "hub" && scope !== "device"
      : scope !== "device"
  ) {
    return unauthenticated(scope);
  }
  const core = CoreId.safeParse(identity[1]);
  const terminal = TerminalId.safeParse(identity[2]);
  if (!core.success || !terminal.success) {
    throw new BadRequest("Invalid Herdr terminal identity");
  }
  if (method === "GET") {
    return api({ state: store.priority(core.data, terminal.data) });
  }
  if (method === "PUT") {
    const input = await parseJson(
      request,
      PriorityPutSchema,
      MAX_PRIORITY_BYTES,
    );
    const result = store.putPriority(core.data, terminal.data, input, now);
    return api({ state: result.state }, result.applied ? 200 : 409);
  }
  const input =
    request.body === null
      ? {}
      : await parseJson(request, PriorityDeleteSchema, MAX_PRIORITY_BYTES);
  const result = store.deletePriority(core.data, terminal.data, input, now);
  return api({ state: result.state }, result.applied ? 200 : 409);
}

export function createBrimApp(
  options: Options,
): (request: Request) => Promise<Response> {
  const { store } = options;
  const clock = options.now ?? (() => new Date());
  const scopeFor = authorize(options.tokens);
  let runningSync: Promise<ArchiveStatus> | undefined;

  function syncArchive(): Promise<ArchiveStatus> {
    if (runningSync !== undefined) return runningSync;
    const refresh = options.syncArchive();
    runningSync = refresh;
    return refresh;
  }

  const routes: Readonly<Record<string, Route>> = {
    "GET /v1/overview": {
      scopes: ["hub"],
      handle: async (_request, url) => {
        const archive = ArchiveStatusSchema.parse(
          await options.archiveStatus(),
        );
        const now = clock();
        return api({
          collector: store.collector(),
          quotas: store.quotas(now),
          billing: store.billing(now),
          quotaHistory:
            url.searchParams.get("includeQuotaHistory") === "false"
              ? []
              : store.quotaHistory(now),
          archive,
        });
      },
    },
    "GET /v1/quotas": {
      scopes: ["hub", "device"],
      handle: () => {
        const { collectedAt, expiresAt } = store.collector();
        return api({
          collectedAt,
          expiresAt,
          snapshots: store.rankingSnapshots(clock()),
        });
      },
    },
    "PUT /v1/publish/macbook": {
      scopes: ["macbook"],
      handle: async (request) => {
        const publication = await parseJson(
          request,
          MacBookPublicationSchema,
          MAX_PUBLICATION_BYTES,
        );
        const now = clock();
        validatePublicationTime(publication, now);
        store.publish(publication, now);
        return api({ collectedAt: publication.collectedAt });
      },
    },
    "POST /internal/v1/sync": {
      scopes: ["scheduler"],
      handle: async () => {
        const refresh = syncArchive();
        try {
          return api({ archive: ArchiveStatusSchema.parse(await refresh) });
        } finally {
          if (runningSync === refresh) runningSync = undefined;
        }
      },
    },
    "GET /v1/priorities": {
      scopes: ["hub", "device"],
      handle: () => api({ priorities: store.priorities() }),
    },
    "PUT /v1/priorities/import": {
      scopes: ["device"],
      handle: async (request) => {
        const input = await parseJson(
          request,
          PriorityImportSchema,
          MAX_IMPORT_BYTES,
        );
        return api({ imported: store.importPriorities(input, clock()) });
      },
    },
  };

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "GET" && path === "/healthz") return new Response("ok");

    const scope = scopeFor(request);
    const selected = routes[`${method} ${path}`];
    if (selected !== undefined) {
      return scope !== undefined && selected.scopes.includes(scope)
        ? await selected.handle(request, url)
        : unauthenticated(scope);
    }
    if (method === "GET" && path.startsWith("/v1/history/")) {
      if (scope !== "hub") return unauthenticated(scope);
      url.pathname = path.replace("/v1/history/", "/v1/");
      const response = await options.history(
        new Request(url.href, { signal: request.signal }),
      );
      return response === null
        ? api({ error: "Not found" }, 404)
        : privateResponse(response);
    }
    const identity = /^\/v1\/priorities\/([^/]+)\/([^/]+)$/u.exec(path);
    return identity !== null && ["GET", "PUT", "DELETE"].includes(method)
      ? await handlePriority(request, { identity, scope }, store, clock())
      : api({ error: "Not found" }, 404);
  }

  return async function handle(request): Promise<Response> {
    try {
      return await route(request);
    } catch (error: unknown) {
      if (error instanceof BadRequest)
        return api({ error: error.message }, error.status);
      throw error;
    }
  };
}
