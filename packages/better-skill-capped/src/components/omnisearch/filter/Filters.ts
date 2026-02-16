import { Role } from "../../../model/Role";
import Type from "../../../model/Type";

export interface Filters {
  roles: Role[];
  types: Type[];
  onlyBookmarked: boolean;
  onlyUnwatched: boolean;
  onlyUnbookmarked: boolean;
  onlyWatched: boolean;
}
