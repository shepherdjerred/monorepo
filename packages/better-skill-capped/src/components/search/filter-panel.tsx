import React from "react";
import type { Kind } from "#src/model/content";
import { KINDS } from "#src/model/content";
import type { Role } from "#src/model/role";
import { ROLES, roleDisplayName } from "#src/model/role";
import type { BookmarkedFilter, WatchedFilter } from "./filters.ts";
import type { SearchParams } from "#src/routes/search";
import type { SearchRunResult } from "#src/search/run-search";
import { FacetChecklist } from "./facet-checklist.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#components/ui/card";
import { Checkbox } from "#components/ui/checkbox";
import { Label } from "#components/ui/label";

export type FilterPanelProps = {
  params: SearchParams;
  facets: SearchRunResult["facets"] | undefined;
  onChange: (updated: Partial<SearchParams>) => void;
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
  count,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  count?: number | undefined;
  checked: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <Label
        htmlFor={id}
        className="flex w-full justify-between gap-2 font-normal"
      >
        <span>{label}</span>
        {count !== undefined && (
          <span className="text-muted-foreground">{count}</span>
        )}
      </Label>
    </div>
  );
}

/** Toggle within "empty array means everything selected" semantics. */
function toggleWithinAll<T extends string>(
  all: readonly T[],
  current: T[],
  value: T,
): T[] {
  const effective = current.length === 0 ? [...all] : current;
  const updated = effective.includes(value)
    ? effective.filter((candidate) => candidate !== value)
    : [...effective, value];
  return updated.length === all.length ? [] : updated;
}

export function FilterPanel({
  params,
  facets,
  onChange,
}: FilterPanelProps): React.ReactElement {
  const effectiveRoles = params.role.length === 0 ? [...ROLES] : params.role;
  const effectiveKinds = params.kind.length === 0 ? [...KINDS] : params.kind;

  const setWatched = (watched: WatchedFilter) => {
    onChange({ watched });
  };
  const setBookmarked = (bookmarked: BookmarkedFilter) => {
    onChange({ bookmarked });
  };

  // Commentary-specific facets are only meaningful when commentaries are in
  // scope (progressive disclosure).
  const commentariesInScope =
    params.kind.length === 0 || params.kind.includes("commentary");

  return (
    <div className="flex flex-col gap-4">
      <FilterSection title="Roles">
        {ROLES.map((role: Role) => (
          <CheckRow
            key={role}
            id={`role-${role}`}
            label={roleDisplayName(role)}
            count={facets?.role[role] ?? 0}
            checked={effectiveRoles.includes(role)}
            onToggle={() => {
              onChange({ role: toggleWithinAll(ROLES, params.role, role) });
            }}
          />
        ))}
      </FilterSection>
      <FilterSection title="Type">
        {KIND_ORDER.map((kind) => (
          <CheckRow
            key={kind}
            id={`type-${kind}`}
            label={KIND_LABELS[kind]}
            count={facets?.kind[kind] ?? 0}
            checked={effectiveKinds.includes(kind)}
            onToggle={() => {
              onChange({ kind: toggleWithinAll(KINDS, params.kind, kind) });
            }}
          />
        ))}
      </FilterSection>
      <FilterSection title="Watch Status">
        <CheckRow
          id="watched-unwatched"
          label="Only show unwatched"
          checked={params.watched === "unwatched"}
          onToggle={() => {
            setWatched(params.watched === "unwatched" ? "any" : "unwatched");
          }}
        />
        <CheckRow
          id="watched-watched"
          label="Only show watched"
          checked={params.watched === "watched"}
          onToggle={() => {
            setWatched(params.watched === "watched" ? "any" : "watched");
          }}
        />
      </FilterSection>
      <FilterSection title="Bookmark Status">
        <CheckRow
          id="bookmarked-only"
          label="Only show bookmarked"
          checked={params.bookmarked === "bookmarked"}
          onToggle={() => {
            setBookmarked(
              params.bookmarked === "bookmarked" ? "any" : "bookmarked",
            );
          }}
        />
        <CheckRow
          id="bookmarked-unbookmarked"
          label="Only show unbookmarked"
          checked={params.bookmarked === "unbookmarked"}
          onToggle={() => {
            setBookmarked(
              params.bookmarked === "unbookmarked" ? "any" : "unbookmarked",
            );
          }}
        />
      </FilterSection>
      {facets !== undefined && (
        <>
          <FacetChecklist
            title="Tags"
            counts={facets.tags}
            selected={params.tag}
            onChange={(tag) => {
              onChange({ tag });
            }}
          />
          {commentariesInScope && (
            <>
              <FacetChecklist
                title="Champion"
                counts={facets.champion}
                selected={params.champion}
                onChange={(champion) => {
                  onChange({ champion });
                }}
              />
              <FacetChecklist
                title="Coach"
                counts={facets.staff}
                selected={params.staff}
                onChange={(staff) => {
                  onChange({ staff });
                }}
              />
              <FacetChecklist
                title="Carry"
                counts={facets.carry}
                selected={params.carry}
                onChange={(carry) => {
                  onChange({ carry });
                }}
              />
              <FacetChecklist
                title="Account Type"
                counts={facets.commentaryType}
                selected={params.ctype}
                onChange={(ctype) => {
                  onChange({ ctype });
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
