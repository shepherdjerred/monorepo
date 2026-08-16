import React from "react";
import { X } from "lucide-react";
import type { SearchParams } from "#src/routes/search";
import { SEARCH_DEFAULTS } from "#src/routes/search";
import { roleDisplayName } from "#src/model/role";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";

export type ActiveFiltersProps = {
  params: SearchParams;
  onChange: (updated: Partial<SearchParams>) => void;
};

type Chip = { key: string; label: string; clear: Partial<SearchParams> };

function collectChips(params: SearchParams): Chip[] {
  const chips: Chip[] = [];
  for (const role of params.role) {
    chips.push({
      key: `role-${role}`,
      label: roleDisplayName(role),
      clear: { role: params.role.filter((candidate) => candidate !== role) },
    });
  }
  for (const kind of params.kind) {
    chips.push({
      key: `kind-${kind}`,
      label: kind,
      clear: { kind: params.kind.filter((candidate) => candidate !== kind) },
    });
  }
  for (const champion of params.champion) {
    chips.push({
      key: `champion-${champion}`,
      label: champion,
      clear: {
        champion: params.champion.filter((candidate) => candidate !== champion),
      },
    });
  }
  for (const staff of params.staff) {
    chips.push({
      key: `staff-${staff}`,
      label: `Coach: ${staff}`,
      clear: { staff: params.staff.filter((candidate) => candidate !== staff) },
    });
  }
  for (const tag of params.tag) {
    chips.push({
      key: `tag-${tag}`,
      label: tag,
      clear: { tag: params.tag.filter((candidate) => candidate !== tag) },
    });
  }
  for (const carry of params.carry) {
    chips.push({
      key: `carry-${carry}`,
      label: `Carry: ${carry}`,
      clear: { carry: params.carry.filter((candidate) => candidate !== carry) },
    });
  }
  for (const ctype of params.ctype) {
    chips.push({
      key: `ctype-${ctype}`,
      label: ctype,
      clear: { ctype: params.ctype.filter((candidate) => candidate !== ctype) },
    });
  }
  if (params.watched !== SEARCH_DEFAULTS.watched) {
    chips.push({
      key: "watched",
      label: params.watched === "any" ? "Including watched" : "Only watched",
      clear: { watched: SEARCH_DEFAULTS.watched },
    });
  }
  if (params.bookmarked !== SEARCH_DEFAULTS.bookmarked) {
    chips.push({
      key: "bookmarked",
      label:
        params.bookmarked === "bookmarked"
          ? "Only bookmarked"
          : "Only unbookmarked",
      clear: { bookmarked: SEARCH_DEFAULTS.bookmarked },
    });
  }
  return chips;
}

/**
 * Every non-default filter as a removable chip — the discoverable
 * replacement for the old fuse operator syntax.
 */
export function ActiveFilters({
  params,
  onChange,
}: ActiveFiltersProps): React.ReactElement | null {
  const chips = collectChips(params);
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="gap-1 pr-1">
          {chip.label}
          <button
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
            onClick={() => {
              onChange(chip.clear);
            }}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onChange({
            role: [],
            kind: [],
            champion: [],
            staff: [],
            tag: [],
            carry: [],
            ctype: [],
            watched: SEARCH_DEFAULTS.watched,
            bookmarked: SEARCH_DEFAULTS.bookmarked,
          });
        }}
      >
        Clear all
      </Button>
    </div>
  );
}
