import type { Role } from "@shepherdjerred/better-skill-capped/model/Role";
import type Type from "@shepherdjerred/better-skill-capped/model/Type";

export type Filters = {
  roles: Role[];
  types: Type[];
  onlyBookmarked: boolean;
  onlyUnwatched: boolean;
  onlyUnbookmarked: boolean;
  onlyWatched: boolean;
}
