import { createRoute, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import { KINDS, type Kind } from "#src/model/content";
import { ROLES, type Role } from "#src/model/role";
import type {
  BookmarkedFilter,
  WatchedFilter,
} from "#src/components/omnisearch/filter/filters";
import { OmniSearch } from "#src/components/omnisearch/omni-search";
import { rootRoute } from "./root.tsx";

export const SEARCH_DEFAULTS: {
  q: string;
  kind: Kind[];
  role: Role[];
  watched: WatchedFilter;
  bookmarked: BookmarkedFilter;
  page: number;
} = {
  q: "",
  kind: [],
  role: [],
  watched: "unwatched",
  bookmarked: "any",
  page: 1,
};

const QSchema = z.string();
const KindsSchema = z.array(z.enum(KINDS));
const RolesSchema = z.array(z.enum(ROLES));
const WatchedSchema = z.enum(["any", "watched", "unwatched"]);
const BookmarkedSchema = z.enum(["any", "bookmarked", "unbookmarked"]);
const PageSchema = z.number().int().min(1);

export type SearchParams = {
  q: string;
  kind: Kind[];
  role: Role[];
  watched: WatchedFilter;
  bookmarked: BookmarkedFilter;
  page: number;
};

function sanitizeField<T>(schema: z.ZodType<T>, value: unknown, def: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : def;
}

/**
 * Per-field validation with per-field fallbacks: a hand-edited or stale URL
 * coerces the invalid fields to their defaults instead of crashing the route
 * or discarding the valid fields. Empty arrays mean "no filter". `watched`
 * defaults to "unwatched": the app has always hidden watched content by
 * default.
 */
export function parseSearchParams(
  input: Record<string, unknown>,
): SearchParams {
  return {
    q: sanitizeField(
      QSchema,
      input["q"] ?? SEARCH_DEFAULTS.q,
      SEARCH_DEFAULTS.q,
    ),
    kind: sanitizeField(
      KindsSchema,
      input["kind"] ?? SEARCH_DEFAULTS.kind,
      SEARCH_DEFAULTS.kind,
    ),
    role: sanitizeField(
      RolesSchema,
      input["role"] ?? SEARCH_DEFAULTS.role,
      SEARCH_DEFAULTS.role,
    ),
    watched: sanitizeField(
      WatchedSchema,
      input["watched"] ?? SEARCH_DEFAULTS.watched,
      SEARCH_DEFAULTS.watched,
    ),
    bookmarked: sanitizeField(
      BookmarkedSchema,
      input["bookmarked"] ?? SEARCH_DEFAULTS.bookmarked,
      SEARCH_DEFAULTS.bookmarked,
    ),
    page: sanitizeField(
      PageSchema,
      input["page"] ?? SEARCH_DEFAULTS.page,
      SEARCH_DEFAULTS.page,
    ),
  };
}

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: parseSearchParams,
  search: {
    middlewares: [stripSearchParams(SEARCH_DEFAULTS)],
  },
  component: OmniSearch,
});
