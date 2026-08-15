import type { Role } from "#src/model/role";
import type { Kind } from "#src/model/content";

export type Filters = {
  roles: Role[];
  types: Kind[];
  onlyBookmarked: boolean;
  onlyUnwatched: boolean;
  onlyUnbookmarked: boolean;
  onlyWatched: boolean;
};
