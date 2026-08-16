import { createRoute, stripSearchParams } from "@tanstack/react-router";
import type { SearchSchemaInput } from "@tanstack/react-router";
import { z } from "zod";
import { KINDS, type Kind } from "#src/model/content";
import { ROLES, type Role } from "#src/model/role";
import type {
  BookmarkedFilter,
  WatchedFilter,
} from "#src/components/search/filters";
import type { SortOption } from "#src/search/run-search";
import { SearchPage } from "#src/components/search/search-page";
import { rootRoute } from "./root.tsx";

export const SEARCH_DEFAULTS: {
  q: string;
  kind: Kind[];
  role: Role[];
  champion: string[];
  staff: string[];
  tag: string[];
  carry: string[];
  ctype: string[];
  watched: WatchedFilter;
  bookmarked: BookmarkedFilter;
  sort: SortOption;
  page: number;
} = {
  q: "",
  kind: [],
  role: [],
  champion: [],
  staff: [],
  tag: [],
  carry: [],
  ctype: [],
  watched: "unwatched",
  bookmarked: "any",
  sort: "relevance",
  page: 1,
};

const QSchema = z.string();
const KindsSchema = z.array(z.enum(KINDS));
const RolesSchema = z.array(z.enum(ROLES));
const StringsSchema = z.array(z.string());
const WatchedSchema = z.enum(["any", "watched", "unwatched"]);
const BookmarkedSchema = z.enum(["any", "bookmarked", "unbookmarked"]);
const SortSchema = z.enum([
  "relevance",
  "newest",
  "oldest",
  "shortest",
  "longest",
]);
const PageSchema = z.number().int().min(1);

export type SearchParams = {
  q: string;
  kind: Kind[];
  role: Role[];
  champion: string[];
  staff: string[];
  tag: string[];
  carry: string[];
  ctype: string[];
  watched: WatchedFilter;
  bookmarked: BookmarkedFilter;
  sort: SortOption;
  page: number;
};

function sanitizeField<T>(schema: z.ZodType<T>, value: unknown, def: T): T {
  const result = schema.safeParse(value ?? def);
  return result.success ? result.data : def;
}

// The all-optional input type matters: TanStack Router derives whether links
// must pass `search` from the validator's input type.
type SearchParamsInput = {
  q?: unknown;
  kind?: unknown;
  role?: unknown;
  champion?: unknown;
  staff?: unknown;
  tag?: unknown;
  carry?: unknown;
  ctype?: unknown;
  watched?: unknown;
  bookmarked?: unknown;
  sort?: unknown;
  page?: unknown;
};

/**
 * Per-field validation with per-field fallbacks: a hand-edited or stale URL
 * coerces the invalid fields to their defaults instead of crashing the route
 * or discarding the valid fields. Empty arrays mean "no filter". `watched`
 * defaults to "unwatched": the app has always hidden watched content by
 * default. `sort: "relevance"` means BM25 order with a query and recency
 * without one.
 */
export function parseSearchParams(input: SearchParamsInput): SearchParams {
  return {
    q: sanitizeField(QSchema, input.q, SEARCH_DEFAULTS.q),
    kind: sanitizeField(KindsSchema, input.kind, SEARCH_DEFAULTS.kind),
    role: sanitizeField(RolesSchema, input.role, SEARCH_DEFAULTS.role),
    champion: sanitizeField(
      StringsSchema,
      input.champion,
      SEARCH_DEFAULTS.champion,
    ),
    staff: sanitizeField(StringsSchema, input.staff, SEARCH_DEFAULTS.staff),
    tag: sanitizeField(StringsSchema, input.tag, SEARCH_DEFAULTS.tag),
    carry: sanitizeField(StringsSchema, input.carry, SEARCH_DEFAULTS.carry),
    ctype: sanitizeField(StringsSchema, input.ctype, SEARCH_DEFAULTS.ctype),
    watched: sanitizeField(
      WatchedSchema,
      input.watched,
      SEARCH_DEFAULTS.watched,
    ),
    bookmarked: sanitizeField(
      BookmarkedSchema,
      input.bookmarked,
      SEARCH_DEFAULTS.bookmarked,
    ),
    sort: sanitizeField(SortSchema, input.sort, SEARCH_DEFAULTS.sort),
    page: sanitizeField(PageSchema, input.page, SEARCH_DEFAULTS.page),
  };
}

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // The SearchSchemaInput brand tells the router that links may omit search
  // params entirely (they all have defaults).
  validateSearch: (input: SearchParamsInput & SearchSchemaInput) =>
    parseSearchParams(input),
  search: {
    middlewares: [stripSearchParams(SEARCH_DEFAULTS)],
  },
  component: SearchPage,
});
