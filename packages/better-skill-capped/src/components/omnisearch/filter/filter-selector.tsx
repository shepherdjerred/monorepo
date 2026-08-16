import React from "react";
import RoleSelector from "./role-selector.tsx";
import type { Filters } from "./filters.ts";
import type { Role } from "#src/model/role";
import type { Kind } from "#src/model/content";
import WatchStatusSelector from "./watch-status-selector.tsx";
import BookmarkStatusSelector from "./bookmark-status-selector.tsx";
import TypeSelector from "./type-selector.tsx";

export type FilterSelectorProps = {
  filters: Filters;
  onFiltersUpdate: (newFilters: Filters) => void;
};

export default function FilterSelector({
  filters,
  onFiltersUpdate,
}: FilterSelectorProps): React.ReactElement {
  const updateFilterRoles = (newRoles: Role[]) => {
    onFiltersUpdate({ ...filters, roles: newRoles });
  };

  const updateFilterTypes = (newTypes: Kind[]) => {
    onFiltersUpdate({ ...filters, types: newTypes });
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
        value={filters.watched}
        onChange={(watched) => {
          onFiltersUpdate({ ...filters, watched });
        }}
      />
      <BookmarkStatusSelector
        value={filters.bookmarked}
        onChange={(bookmarked) => {
          onFiltersUpdate({ ...filters, bookmarked });
        }}
      />
    </>
  );
}
