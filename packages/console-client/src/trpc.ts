import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { createTRPCContext } from "@trpc/tanstack-react-query";

export type ConsoleTRPCClientOptions = {
  /** @default "/trpc", same origin */
  readonly url?: string;
};

/**
 * The browser's tRPC client: queries and mutations batch over HTTP,
 * subscriptions stream over SSE (`httpSubscriptionLink`, as Hub does).
 */
export function createConsoleTRPCClient<TRouter extends AnyTRPCRouter>(
  options: ConsoleTRPCClientOptions = {},
) {
  const url = options.url ?? "/trpc";
  return createTRPCClient<TRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === "subscription",
        true: httpSubscriptionLink({ url }),
        false: httpBatchLink<AnyTRPCRouter>({ url }),
      }),
    ],
  });
}

/**
 * The TanStack Query bindings for one console's router:
 * `{ TRPCProvider, useTRPC, useTRPCClient }` from
 * `@trpc/tanstack-react-query`. Call once per app at module scope.
 */
export function createConsoleTRPCReact<TRouter extends AnyTRPCRouter>() {
  return createTRPCContext<TRouter>();
}
