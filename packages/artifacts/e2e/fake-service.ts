/**
 * An in-memory fake of the artifacts service for the browser e2e: the same
 * tRPC wire contract (the real input and output schemas), the upload routes,
 * the live SSE streams and the content host, with no database and no object
 * store. When the real server can run under Playwright, swap `start.ts` to
 * boot it; nothing outside the `fake-*` files depends on how the fake keeps
 * its data.
 *
 * Deliberate differences from the real service:
 * - `data.conflict` of a `boards.replace` CONFLICT is added by patching the
 *   response, because `rpc.ts` has no error formatter. The real server should
 *   put it in an `errorFormatter`.
 * - `POST /api/_e2e/reset` empties the store between specs.
 * - `resolve` and `reopen` are idempotent; replying to a resolved thread is
 *   BAD_REQUEST.
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import {
  ACTOR_HEADER,
  ActorSchema,
  BoardSlugSchema,
  FeedbackScopeSchema,
  type Actor,
  type FeedbackScope,
} from "#shared/contract.ts";
import type { FakeServiceOptions } from "./fake-types.ts";
import type { FakeContext } from "./fake-trpc.ts";
import { createContentHandler } from "./fake-content.ts";
import { addWaiter, sseResponse, subscribe } from "./fake-hub.ts";
import { createFakeRouter } from "./fake-router.ts";
import { defaultScope } from "./fake-threads.ts";
import {
  BROWSER_ACTOR,
  actorRef,
  createStore,
  emptyData,
  requestScope,
  type Origins,
  type RequestScope,
} from "./fake-types.ts";
import { handleUploadRoute } from "./fake-uploads.ts";

export type FakeService = {
  /** Records the two listeners' origins; call before serving a request. */
  readonly configure: (origins: Origins) => void;
  /** Serves `/trpc`, `/api/*`; null for any other path. */
  readonly appFetch: (request: Request) => Promise<Response | null>;
  readonly contentFetch: (request: Request) => Response | Promise<Response>;
  /** Forgets every board, artifact, thread and blob. */
  readonly reset: () => void;
};

class ActorHeaderError extends Error {}

/** Browsers send no header and are `human:jerred`; agents send base64 JSON. */
function actorOf(request: Request): Actor {
  const header = request.headers.get(ACTOR_HEADER);
  if (header === null) return BROWSER_ACTOR;
  try {
    return ActorSchema.parse(JSON.parse(atob(header)));
  } catch {
    throw new ActorHeaderError(`${ACTOR_HEADER} is not a base64 JSON actor`);
  }
}

const ConflictBody = z.looseObject({
  error: z
    .looseObject({
      data: z.looseObject({ path: z.string().optional() }).optional(),
    })
    .optional(),
});

/** Adds `data.conflict` to the tRPC errors whose procedure stashed a document. */
async function withConflicts(
  response: Response,
  conflicts: ReadonlyMap<string, unknown>,
): Promise<Response> {
  if (conflicts.size === 0) return response;
  const parsed = z
    .union([ConflictBody, z.array(ConflictBody)])
    .parse(await response.json());
  const patch = (
    entry: z.infer<typeof ConflictBody>,
  ): z.infer<typeof ConflictBody> => {
    const path = entry.error?.data?.path;
    if (
      path === undefined ||
      !conflicts.has(path) ||
      entry.error?.data === undefined
    )
      return entry;
    entry.error.data["conflict"] = conflicts.get(path);
    return entry;
  };
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(
    Array.isArray(parsed) ? parsed.map(patch) : patch(parsed),
    {
      status: response.status,
      headers,
    },
  );
}

/** `?board=<slug>` or `?artifact=<id>`; a bare stream follows the caller's own artifacts. */
function scopeOf(url: URL, actor: Actor): FeedbackScope | null {
  const board = url.searchParams.get("board");
  const artifact = url.searchParams.get("artifact");
  let raw: unknown = defaultScope(actor);
  if (board !== null) raw = { type: "board", board };
  else if (artifact !== null) raw = { type: "artifact", artifactId: artifact };
  const parsed = FeedbackScopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function noop(): void {
  // nothing to clean up
}

export function createFakeService(
  options: FakeServiceOptions = {},
): FakeService {
  const store = createStore(options);
  const router = createFakeRouter(store);

  function touchActor(actor: Actor): void {
    store.seen.set(actor.key, store.options.now());
  }

  async function trpc(request: Request, actor: Actor): Promise<Response> {
    const scope: RequestScope = { actor, conflicts: new Map() };
    const response = await requestScope.run(scope, () =>
      fetchRequestHandler({
        endpoint: "/trpc",
        req: request,
        router,
        createContext: (): FakeContext => ({
          requestId: crypto.randomUUID(),
          hostClass: "app",
        }),
      }),
    );
    return withConflicts(response, scope.conflicts);
  }

  function eventsStream(request: Request, url: URL): Response {
    const slug = url.searchParams.get("board");
    if (slug !== null && !BoardSlugSchema.safeParse(slug).success)
      return Response.json({ error: "invalid board" }, { status: 400 });
    return sseResponse(store, request.signal, (send) => {
      const board =
        slug === null
          ? undefined
          : [...store.boards.values()].find((entry) => entry.slug === slug);
      if (slug !== null && board === undefined) {
        send({ type: "gone" });
        return noop;
      }
      send({
        type: "ready",
        scope:
          slug === null
            ? { type: "owner", ownerKey: BROWSER_ACTOR.key }
            : { type: "board", board: slug },
        pending: 0,
      });
      return subscribe(store, { board: slug, send });
    });
  }

  /** The agent wake-up stream; a connected agent is listed by `feedback.waiters`. */
  function feedbackStream(request: Request, url: URL, actor: Actor): Response {
    const scope = scopeOf(url, actor);
    if (scope === null)
      return Response.json({ error: "invalid scope" }, { status: 400 });
    return sseResponse(store, request.signal, (send) => {
      send({ type: "ready", scope, pending: 0 });
      return addWaiter(store, {
        actor: actorRef(actor),
        scope,
        since: store.options.now(),
        send,
      });
    });
  }

  async function appFetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/api/_e2e/reset" && request.method === "POST") {
      Object.assign(store, emptyData());
      return new Response(null, { status: 204 });
    }
    if (!pathname.startsWith("/trpc") && !pathname.startsWith("/api/"))
      return null;
    let actor: Actor;
    try {
      actor = actorOf(request);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "bad actor" },
        { status: 400 },
      );
    }
    touchActor(actor);
    if (pathname === "/trpc" || pathname.startsWith("/trpc/"))
      return trpc(request, actor);
    if (pathname === "/api/events/stream" && request.method === "GET")
      return eventsStream(request, url);
    if (pathname === "/api/feedback/stream" && request.method === "GET")
      return feedbackStream(request, url, actor);
    const upload = await handleUploadRoute(store, request, actor).catch(
      (error: unknown) =>
        Response.json(
          { error: error instanceof Error ? error.message : "bad request" },
          { status: 400 },
        ),
    );
    return upload ?? Response.json({ error: "not found" }, { status: 404 });
  }

  const contentFetch = createContentHandler({
    resolveToken(token) {
      const id = store.tokens.get(token);
      const version = id === undefined ? undefined : store.versions.get(id);
      if (version === undefined) return null;
      return {
        entryPath: version.entryPath,
        files: new Map(version.files.map((file) => [file.path, file])),
      };
    },
    blob: (sha256) => store.blobs.get(sha256) ?? null,
    origins() {
      if (store.origins === null)
        throw new Error("the fake service has no origins yet");
      return store.origins;
    },
  });

  return {
    configure(origins) {
      store.origins = origins;
    },
    appFetch,
    contentFetch,
    reset() {
      Object.assign(store, emptyData());
    },
  };
}
