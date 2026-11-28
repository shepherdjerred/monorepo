import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createConsoleQueryClient } from "./query.ts";

export type RenderWithRouterOptions = {
  /** The URL the memory history starts at. @default "/" */
  readonly url?: string;
  /** Wraps the node in a `QueryClientProvider` too. */
  readonly queryClient?: QueryClient;
};

/**
 * Static markup of a component that renders router links (and, with
 * `queryClient`, reads queries). Lifted from Delivery's `test-router.tsx`.
 */
export function renderWithRouter(
  node: ReactNode,
  options: RenderWithRouterOptions = {},
): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [options.url ?? "/"] }),
  });
  const routed = (
    <RouterContextProvider router={router}>{node}</RouterContextProvider>
  );
  return renderToStaticMarkup(
    options.queryClient === undefined ? (
      routed
    ) : (
      <QueryClientProvider client={options.queryClient}>
        {routed}
      </QueryClientProvider>
    ),
  );
}

/** A query client for tests: the console defaults, but no retries. */
export function createTestQueryClient(): QueryClient {
  return createConsoleQueryClient({
    queries: { retry: false, staleTime: Infinity },
  });
}
