import React from "react";
import type { Kind } from "#src/model/content";
import type { Role } from "#src/model/role";
import { ROLES, roleDisplayName } from "#src/model/role";
import type { BookmarkedFilter, Filters, WatchedFilter } from "./filters.ts";
import { Card, CardContent, CardHeader, CardTitle } from "#components/ui/card";
import { Checkbox } from "#components/ui/checkbox";
import { Label } from "#components/ui/label";

export type FilterPanelProps = {
  filters: Filters;
  onFiltersUpdate: (newFilters: Filters) => void;
};

const KIND_LABELS: Record<Kind, string> = {
  video: "Video",
  commentary: "Commentary",
  course: "Course",
};

const KIND_ORDER: Kind[] = ["video", "commentary", "course"];

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4">{children}</CardContent>
    </Card>
  );
}

function CheckRow({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

export function FilterPanel({
  filters,
  onFiltersUpdate,
}: FilterPanelProps): React.ReactElement {
  const toggleRole = (role: Role) => {
    const roles = filters.roles.includes(role)
      ? filters.roles.filter((candidate) => candidate !== role)
      : [...filters.roles, role];
    onFiltersUpdate({ ...filters, roles });
  };

  const toggleType = (type: Kind) => {
    const types = filters.types.includes(type)
      ? filters.types.filter((candidate) => candidate !== type)
      : [...filters.types, type];
    onFiltersUpdate({ ...filters, types });
  };

  const setWatched = (watched: WatchedFilter) => {
    onFiltersUpdate({ ...filters, watched });
  };

  const setBookmarked = (bookmarked: BookmarkedFilter) => {
    onFiltersUpdate({ ...filters, bookmarked });
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterSection title="Roles">
        {ROLES.map((role) => (
          <CheckRow
            key={role}
            id={`role-${role}`}
            label={roleDisplayName(role)}
            checked={filters.roles.includes(role)}
            onToggle={() => {
              toggleRole(role);
            }}
          />
        ))}
      </FilterSection>
      <FilterSection title="Type">
        {KIND_ORDER.map((type) => (
          <CheckRow
            key={type}
            id={`type-${type}`}
            label={KIND_LABELS[type]}
            checked={filters.types.includes(type)}
            onToggle={() => {
              toggleType(type);
            }}
          />
        ))}
      </FilterSection>
      <FilterSection title="Watch Status">
        <CheckRow
          id="watched-unwatched"
          label="Only show unwatched"
          checked={filters.watched === "unwatched"}
          onToggle={() => {
            setWatched(filters.watched === "unwatched" ? "any" : "unwatched");
          }}
        />
        <CheckRow
          id="watched-watched"
          label="Only show watched"
          checked={filters.watched === "watched"}
          onToggle={() => {
            setWatched(filters.watched === "watched" ? "any" : "watched");
          }}
        />
      </FilterSection>
      <FilterSection title="Bookmark Status">
        <CheckRow
          id="bookmarked-only"
          label="Only show bookmarked"
          checked={filters.bookmarked === "bookmarked"}
          onToggle={() => {
            setBookmarked(
              filters.bookmarked === "bookmarked" ? "any" : "bookmarked",
            );
          }}
        />
        <CheckRow
          id="bookmarked-unbookmarked"
          label="Only show unbookmarked"
          checked={filters.bookmarked === "unbookmarked"}
          onToggle={() => {
            setBookmarked(
              filters.bookmarked === "unbookmarked" ? "any" : "unbookmarked",
            );
          }}
        />
      </FilterSection>
    </div>
  );
}
