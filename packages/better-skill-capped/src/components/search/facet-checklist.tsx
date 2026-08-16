import React, { useState } from "react";
import type { FacetCounts } from "#src/search/run-search";
import { Card, CardContent, CardHeader, CardTitle } from "#components/ui/card";
import { Checkbox } from "#components/ui/checkbox";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";

export type FacetChecklistProps = {
  title: string;
  counts: FacetCounts;
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Show a filter input when there are more values than this. */
  searchThreshold?: number;
  /** Cap the visible list; selected values always show. */
  visibleLimit?: number;
};

/**
 * A facet section: values sorted by count (then name), live conjunctive
 * counts, optional type-ahead narrowing for high-cardinality facets
 * (champions). Zero-count unselected values are hidden.
 */
export function FacetChecklist({
  title,
  counts,
  selected,
  onChange,
  searchThreshold = 12,
  visibleLimit = 10,
}: FacetChecklistProps): React.ReactElement | null {
  const [filter, setFilter] = useState("");

  const values = Object.entries(counts)
    .filter(([value, count]) => count > 0 || selected.includes(value))
    .sort(([aValue, aCount], [bValue, bCount]) =>
      bCount === aCount ? aValue.localeCompare(bValue) : bCount - aCount,
    );

  if (values.length === 0 && selected.length === 0) {
    return null;
  }

  const lowered = filter.toLowerCase();
  const visible = values
    .filter(
      ([value]) =>
        selected.includes(value) ||
        lowered === "" ||
        value.toLowerCase().includes(lowered),
    )
    .filter(
      ([value], index) =>
        selected.includes(value) || lowered !== "" || index < visibleLimit,
    );

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((candidate) => candidate !== value)
        : [...selected, value],
    );
  };

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4">
        {values.length > searchThreshold && (
          <Input
            value={filter}
            placeholder={`Filter ${title.toLowerCase()}…`}
            className="h-8"
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
        )}
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
          {visible.map(([value, count]) => (
            <div key={value} className="flex items-center gap-2">
              <Checkbox
                id={`${title}-${value}`}
                checked={selected.includes(value)}
                onCheckedChange={() => {
                  toggle(value);
                }}
              />
              <Label
                htmlFor={`${title}-${value}`}
                className="flex w-full justify-between gap-2 font-normal"
              >
                <span className="truncate">{value}</span>
                <span className="text-muted-foreground">{count}</span>
              </Label>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
