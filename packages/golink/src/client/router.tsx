import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useSearch,
  type RouterHistory,
} from "@tanstack/react-router";
import type { ThemeStore } from "@shepherdjerred/console-ui";
import { focusOnNavigate, zodSearch } from "@shepherdjerred/console-client";
import { z } from "zod";
import { normalizeShortSlug, RESERVED_SLUGS } from "#shared/contract.ts";
import { App } from "./app.tsx";

/** `?missing=<slug>`: a go/ name that did not resolve, offered for creation. */
const MissingSlugSchema = z
  .string()
  .transform((value) => normalizeShortSlug(value))
  .refine((value) => value.length > 0 && !RESERVED_SLUGS.has(value));

/** The one route's search: `?missing=` when valid, nothing otherwise. */
const directorySearch = zodSearch({ missing: MissingSlugSchema });
const SearchParamsSchema = z.record(z.string(), z.unknown());

function DirectoryPage({ theme }: { readonly theme: ThemeStore }) {
  // The route already validated the search; parsing it again types it here
  // without registering the router globally (declaration merging needs an
  // `interface`, which the lint forbids).
  const search: unknown = useSearch({ strict: false });
  const { missing } = directorySearch(SearchParamsSchema.parse(search));
  return <App theme={theme} missingSlug={missing ?? null} />;
}

/**
 * The server answers an unknown `go/<slug>` with the SPA shell at that path.
 * Rewrite it to the one route, `/?missing=<slug>`, before the router starts.
 */
export function missingSlugUrl(
  pathname: string,
  search: string,
): string | null {
  if (pathname === "/" || pathname === "/index.html") return null;
  let rawSegment = pathname.replaceAll(/^\/+|\/+$/gu, "");
  try {
    rawSegment = decodeURIComponent(rawSegment);
  } catch {
    // Keep the raw path when percent-decoding fails.
  }
  const params = new URLSearchParams(search);
  if (!params.has("missing")) params.set("missing", rawSegment);
  return `/?${params.toString()}`;
}

/** One route, `/`, whose search carries `?missing=`. */
export function createGolinkRouter(theme: ThemeStore, history?: RouterHistory) {
  const rootRoute = createRootRoute({ component: Outlet });
  const directoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    validateSearch: directorySearch,
    component: () => <DirectoryPage theme={theme} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([directoryRoute]),
    ...(history === undefined ? {} : { history }),
  });
  focusOnNavigate(router);
  return router;
}
