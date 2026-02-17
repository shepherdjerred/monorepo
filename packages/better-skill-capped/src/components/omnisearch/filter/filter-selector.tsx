import React from "react";
import RoleSelector from "./role-selector";
import type { Filters } from "./filters";
import type { Role } from "#src/model/role";
import WatchStatusSelector from "./watch-status-selector";
import BookmarkStatusSelector from "./bookmark-status-selector";
import TypeSelector from "./type-selector";
import type Type from "#src/model/type";

export type FilterSelectorProps = {
  filters: Filters;
  onFiltersUpdate: (newFilters: Filters) => void;
};

export default function FilterSelector({
  filters,
  onFiltersUpdate,
}: FilterSelectorProps): React.ReactElement {
  const updateFilterRoles = (newRoles: Role[]) => {
    const newFilters = {
      ...filters,
      roles: newRoles,
    };
    onFiltersUpdate(newFilters);
  };

  const updateFilterBookmark = (
    onlyShowBookmarked: boolean,
    onlyShowUnbookmarked: boolean,
  ) => {
    const newFilters = {
      ...filters,
      onlyBookmarked: onlyShowBookmarked,
      onlyUnbookmarked: onlyShowUnbookmarked,
    };
    onFiltersUpdate(newFilters);
  };

  const updateFilterWatchStatus = (
    onlyShowUnwatched: boolean,
    onlyShowWatched: boolean,
  ) => {
    const newFilters = {
      ...filters,
      onlyUnwatched: onlyShowUnwatched,
      onlyWatched: onlyShowWatched,
    };
    onFiltersUpdate(newFilters);
  };

  const updateFilterTypes = (newTypes: Type[]) => {
    const newFilters = {
      ...filters,
      types: newTypes,
    };
    onFiltersUpdate(newFilters);
  };

  return (
    <>
      <RoleSelector
        selectedRoles={filters.roles}
        onRolesUpdate={updateFilterRoles}
      />
      <TypeSelector
        selectedTypes={filters.types}
        onTypesUpdate={updateFilterTypes}
      />
      <WatchStatusSelector
        onlyShowUnwatched={filters.onlyUnwatched}
        onlyShowWatched={filters.onlyWatched}
        onSelectionChange={updateFilterWatchStatus}
      />
      <BookmarkStatusSelector
        onlyShowBookmarked={filters.onlyBookmarked}
        onlyShowUnbookmarked={filters.onlyUnbookmarked}
        onSelectionChange={updateFilterBookmark}
      />
    </>
  );
}
