import { z } from "zod";

/**
 * How a list is laid out. Everything lives in the address so a view can be
 * shared: `group`, `collapsed` (repeated group keys), `hide` (repeated row
 * properties) and the existing `sort`. Defaults are left out of the URL.
 */
export const GroupBySchema = z.enum([
  "status",
  "priority",
  "project",
  "assignee",
  "none",
]);
export type GroupBy = z.infer<typeof GroupBySchema>;
export const SortSchema = z.enum(["updated", "created", "priority", "votes"]);
export type Sort = z.infer<typeof SortSchema>;
export const RowPropertySchema = z.enum([
  "labels",
  "project",
  "date",
  "assignee",
]);
export type RowProperty = z.infer<typeof RowPropertySchema>;
export const rowProperties = RowPropertySchema.options;

export const displayParams = {
  group: "group",
  collapsed: "collapsed",
  hide: "hide",
  sort: "sort",
} as const;

export const defaultGroupBy: GroupBy = "status";
export const defaultSort: Sort = "updated";

export type DisplayOptions = {
  groupBy: GroupBy;
  collapsed: ReadonlySet<string>;
  hidden: ReadonlySet<RowProperty>;
  sort: Sort;
};

/** Unknown values in a hand-edited link fall back to the defaults. */
export function readDisplay(params: URLSearchParams): DisplayOptions {
  const group = GroupBySchema.safeParse(params.get(displayParams.group));
  const sort = SortSchema.safeParse(params.get(displayParams.sort));
  return {
    groupBy: group.success ? group.data : defaultGroupBy,
    collapsed: new Set(params.getAll(displayParams.collapsed)),
    hidden: new Set(
      params.getAll(displayParams.hide).flatMap((value) => {
        const parsed = RowPropertySchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
    sort: sort.success ? sort.data : defaultSort,
  };
}

function setAll(
  params: URLSearchParams,
  key: string,
  values: Iterable<string>,
) {
  params.delete(key);
  for (const value of values) {
    params.append(key, value);
  }
}

/** The address with some display options changed; the rest are kept. */
export function writeDisplay(
  params: URLSearchParams,
  change: Partial<DisplayOptions>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (change.groupBy !== undefined) {
    if (change.groupBy === defaultGroupBy) {
      next.delete(displayParams.group);
    } else {
      next.set(displayParams.group, change.groupBy);
    }
    // Group keys mean something else under another grouping.
    next.delete(displayParams.collapsed);
  }
  if (change.collapsed !== undefined) {
    setAll(next, displayParams.collapsed, [...change.collapsed].sort());
  }
  const { hidden } = change;
  if (hidden !== undefined) {
    setAll(
      next,
      displayParams.hide,
      rowProperties.filter((property) => hidden.has(property)),
    );
  }
  if (change.sort !== undefined) {
    if (change.sort === defaultSort) {
      next.delete(displayParams.sort);
    } else {
      next.set(displayParams.sort, change.sort);
    }
  }
  return next;
}

/** Collapse an expanded group or expand a collapsed one. */
export function toggleCollapsed(params: URLSearchParams, key: string) {
  const collapsed = new Set(readDisplay(params).collapsed);
  if (collapsed.has(key)) {
    collapsed.delete(key);
  } else {
    collapsed.add(key);
  }
  return writeDisplay(params, { collapsed });
}
