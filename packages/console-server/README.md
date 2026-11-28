# @shepherdjerred/console-server

The one way a TypeScript ops console's server starts: Hono on `Bun.serve`, with
health, metrics, request logs, tracing, identity, tRPC and the client build
wired the same way in every app. Its browser half is
[`@shepherdjerred/console-client`](../console-client/). The stack it belongs to
is described in the wiki's console stack reference.

Server-only: never import it from client code. Typed callers outside the
browser import `@shepherdjerred/console-server/caller`, which loads only
`@trpc/client`.

## Start a server

```ts
import {
  createConsoleServer,
  createConsoleTRPC,
  LOOPBACK_PROXIES,
  machineToken,
  tailscaleIdentity,
  type ConsoleTRPCContext,
} from "@shepherdjerred/console-server";

type Context = ConsoleTRPCContext & { readonly db: Database };
const { router, publicProcedure, viewerProcedure, machineProcedure } =
  createConsoleTRPC<Context>();

export const appRouter = router({
  items: router({
    list: publicProcedure.query(({ ctx }) => ctx.db.items()),
    add: viewerProcedure
      .input(ItemInputSchema)
      .mutation(({ ctx, input }) => ctx.db.add(input, ctx.viewer.login)),
    sync: machineProcedure("sync").mutation(({ ctx }) => ctx.db.sync()),
  }),
});
export type AppRouter = typeof appRouter;

const server = createConsoleServer({
  name: "items",
  port: 8080,
  identity: [
    machineToken({
      credentials: [
        { id: "temporal", token: env.ITEMS_TOKEN, scopes: ["sync"] },
      ],
    }),
    tailscaleIdentity({ trustedProxies: LOOPBACK_PROXIES }),
  ],
  trpc: { router: appRouter, createContext: (input) => ({ ...input, db }) },
  staticDir: path.resolve(import.meta.dir, "../../dist/client"),
  health: { ready: { database: () => db.ping() } },
  onError: reportError,
  onShutdown: () => db.close(),
});
server.start();
```

`start()` listens and stops gracefully on `SIGTERM`/`SIGINT`; tests call
`server.app.request(url, init, { peerAddress })` instead.

## What every server gets

| Concern  | Behaviour                                                                                                                                                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order    | Secure headers, request middleware, identity, `/healthz`, `/readyz`, `/metrics`, tRPC, client files, then the app's `routes(app)`, then the SPA fallback.                                                                                                                                                                                                              |
| Health   | `/healthz` is `200 ok`. `/readyz` is `200 ready` only when every `health.ready` check resolves `true`; a throwing check is reported and counts as not ready (`503 not ready`).                                                                                                                                                                                         |
| Metrics  | `/metrics` renders the registry (`createConsoleRegistry(name)`: `service=<name>` label, process metrics prefixed `<name>_`). Every request lands in `<name>_http_request_duration_seconds{method,route,status}`; `route` is the Hono route pattern, `static`/`spa` for files and `unmatched` for an unclaimed 404. `metrics.collect` refreshes gauges before a scrape. |
| Logs     | One JSON line per request (`level`, `message: "http_request"`, `service`, `requestId`, `traceId` when tracing, `method`, `path`, `route`, `status`, `durationMs`); probes and scrapes are not logged. `x-request-id` is echoed or generated.                                                                                                                           |
| Tracing  | A server span per request on the global OpenTelemetry tracer, continuing an incoming `traceparent`. Spans export only when the app started an SDK (see Go link's `telemetry.ts`); otherwise the API is a no-op.                                                                                                                                                        |
| Errors   | An unhandled error logs `request_failed`, goes to `onError` and answers `500 {"error":"Internal server error"}`. tRPC `INTERNAL_SERVER_ERROR`s go to `onError` too. Sentry or the errors console stay the app's choice.                                                                                                                                                |
| Static   | `staticDir` is served with `@hono/bun`'s `serveStatic`: `assets/*` cached `immutable` for a year (a missing one is `404`, never the shell), `index.html` `no-cache`, other root files an hour. `spaFallback` (default on) answers any other GET with `index.html`; turn it off when unknown paths mean something (Go link's redirects).                                |
| Shutdown | `stop()` ends live tRPC subscriptions, lets in-flight requests drain, then runs `onShutdown`.                                                                                                                                                                                                                                                                          |

## Identity

`identity` is a list of schemes; the first that applies names the caller, and a
request no scheme claims is `{ kind: "anonymous" }`. REST handlers read it with
`await identityOf(c)`; tRPC procedures get `ctx.identity`.

- `tailscaleIdentity({ trustedProxies, required?, operatorLogins?, publicOrigin? })`
  trusts `tailscale-user-login`/`tailscale-user-name` only when the TCP peer is
  a trusted proxy (the check Flags, Feeds and Delivery use); a header from any
  other peer is ignored, so a spoofed login never names a viewer.
  `trustedProxies` is a list of addresses and CIDRs (`LOOPBACK_PROXIES` for an
  in-Pod Tailscale sidecar) or an async resolver such as Flags' Kubernetes
  ingress verification. `required` turns an untrusted or login-less request
  into `401`/`403` instead of anonymous; `operatorLogins` and `publicOrigin`
  add the allowlist and same-origin checks for state-changing requests.
- `machineToken({ credentials })` accepts `Authorization: Bearer <token>`
  compared in constant time, naming the caller's `id` and `scopes`. A wrong
  token is `401` on every route; it never falls back to anonymous.

Procedure helpers from `createConsoleTRPC<Context>()`:

| Helper                    | Allows                                               | Adds to `ctx` |
| ------------------------- | ---------------------------------------------------- | ------------- |
| `publicProcedure`         | anyone                                               |               |
| `viewerProcedure`         | a Tailscale viewer (`UNAUTHORIZED` otherwise)        | `viewer`      |
| `machineProcedure(scope)` | a machine token holding `scope` (`FORBIDDEN` if not) | `machine`     |

## tRPC

`createConsoleTRPC` uses no transformer (plain JSON, as Hub and Tracker do),
validates input with the procedure's Zod schema and reports its issues under
`error.data.zodError` (`z.flattenError`), and serves subscriptions over SSE
with a 15-second ping (Bun's idle timeout is 60 seconds) for
`httpSubscriptionLink`. The fetch adapter is mounted at `trpc.endpoint`
(default `/trpc`).

## Typed callers

```ts
import { createConsoleClient } from "@shepherdjerred/console-server/caller";
import type { AppRouter } from "@shepherdjerred/golink/trpc-contract";

const golink = createConsoleClient<AppRouter>({ url: env.GOLINK_URL, token });
const directory = await golink.links.list.query();
```

Batched over HTTP with a 30-second timeout; no schema is repeated because the
types come from the router.

## Adopting the kit

1. Replace the app's `Bun.serve` and hand-written health, metrics, logging and
   static routes with `createConsoleServer`; keep the app's own metrics by
   registering them on `createConsoleRegistry(name)` and passing it as
   `metrics.registry`. Existing metric names stay.
2. Move identity to `tailscaleIdentity`/`machineToken` with the app's current
   trust rule.
3. Add tRPC procedures beside the REST routes and move the browser to them
   (`@shepherdjerred/console-client`).
4. **Serve both, move callers, then delete.** REST routes stay, unchanged, until
   every caller has moved; delete one only when its
   `<name>_http_request_duration_seconds_count{route="…"}` has stayed at zero
   across a full release of every caller. List the remaining REST callers in
   the app's README. Fixed outside protocols (redirects, ingest endpoints,
   webhooks, probes, `/metrics`) stay REST.

Go link is the first app on the kit (`packages/golink/src/server/app.ts`).
