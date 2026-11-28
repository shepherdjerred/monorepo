# @shepherdjerred/console-client

The browser half of the console kit: one TanStack Query set-up, the tRPC
bindings, and the TanStack Router adapters for console-ui. Its server half is
[`@shepherdjerred/console-server`](../console-server/).

It is a separate workspace, not a subpath of the server kit, so a Vite bundle
can never resolve Hono, prom-client or OpenTelemetry through it: the isolated
linker only lets this package reach the browser libraries it declares.

## Data

```tsx
import {
  createConsoleQueryClient,
  createConsoleTRPCClient,
  createConsoleTRPCReact,
} from "@shepherdjerred/console-client";
import type { AppRouter } from "#shared/trpc-contract.ts";

export const { TRPCProvider, useTRPC } = createConsoleTRPCReact<AppRouter>();

const queryClient = createConsoleQueryClient();
const trpcClient = createConsoleTRPCClient<AppRouter>(); // "/trpc"

<QueryClientProvider client={queryClient}>
  <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
    <RouterProvider router={router} />
  </TRPCProvider>
</QueryClientProvider>;
```

- Query defaults (`CONSOLE_QUERY_DEFAULTS`): `retry: 1` (a blip is retried
  once, an outage shows at once), `staleTime: 15_000` (returning within 15
  seconds reuses data), `refetchOnWindowFocus: true`.
- The tRPC client batches queries and mutations over HTTP and streams
  subscriptions over SSE (`httpSubscriptionLink`), split on the operation type.
- Components use `useTRPC()` with TanStack Query:
  `useQuery(trpc.items.list.queryOptions())`,
  `useMutation(trpc.items.add.mutationOptions())`, and invalidate with
  `trpc.items.list.queryKey()`.

## Router

- `consoleRouterLink(options?)` is a console-ui `renderLink`: it renders
  TanStack Router's `<Link>`, so the active route's link gets
  `aria-current="page"` (no `active` class). `exact` and `includeSearch`
  narrow what counts as active. The props are console-ui's `RenderLinkProps`,
  declared structurally.
- `focusOnNavigate(router, targets?)`, called once where the router is
  created, moves focus to `#main-heading` (or the first of `targets` the page
  has) after every navigation that changed the path, never on first load, and
  retries a frame later if the element was replaced (Delivery's behaviour).
  Pass a function to choose targets per navigation. It is not a hook because
  the repository's lint forbids `useEffect`.
- `zodSearch({ key: schema, … })` is a route's `validateSearch`: every key is
  optional, a value that fails its schema is dropped and the rest kept, unknown
  keys are stripped. `lenient(schema)` is the per-field form.

## Tests

`@shepherdjerred/console-client/testing`:

- `renderWithRouter(node, { url?, queryClient? })` renders static markup inside
  a memory-history router (and a `QueryClientProvider`), so components with
  router links or queries render in Vitest without a browser.
- `createTestQueryClient()` is the console defaults without retries.
