import type { Role } from "#src/model/role";
import type Type from "#src/model/type";

export type Filters = {
  roles: Role[];
  types: Type[];
  onlyBookmarked: boolean;
  onlyUnwatched: boolean;
  onlyUnbookmarked: boolean;
  onlyWatched: boolean;
};
