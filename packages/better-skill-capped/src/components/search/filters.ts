import type { Role } from "#src/model/role";
import type { Kind } from "#src/model/content";

export type WatchedFilter = "any" | "watched" | "unwatched";
export type BookmarkedFilter = "any" | "bookmarked" | "unbookmarked";

/** Empty `roles`/`types` arrays mean "no filter" (everything passes). */
export type Filters = {
  roles: Role[];
  types: Kind[];
  watched: WatchedFilter;
  bookmarked: BookmarkedFilter;
};
