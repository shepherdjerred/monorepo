import { z } from "zod";
import type { Issue } from "#client/data/api.ts";

/**
 * How a list or board is laid out. Everything lives in the address so a view
 * can be shared: `group`, `collapsed` (repeated group keys), `hide` (repeated
 * row properties), `sort` and `dir`. Defaults are left out of the URL.
 */
export const GroupBySchema = z.enum([
  "status",
  "priority",
  "urgency",
  "impact",
  "effort",
  "project",
  "assignee",
  "due",
  "none",
]);
export type GroupBy = z.infer<typeof GroupBySchema>;

export const SortSchema = z.enum([
  "updated",
  "created",
  "priority",
  "urgency",
  "impact",
  "effort",
  "votes",
  "due",
  "number",
  "title",
]);
export type Sort = z.infer<typeof SortSchema>;

export const BoardSortSchema = z.enum(["board", ...SortSchema.options]);
export type BoardSort = z.infer<typeof BoardSortSchema>;

export const SortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof SortDirSchema>;

export const RowPropertySchema = z.enum([
  "labels",
  "effort",
  "project",
  "date",
  "due",
  "assignee",
]);
export type RowProperty = z.infer<typeof RowPropertySchema>;
export const rowProperties = RowPropertySchema.options;

export const displayParams = {
  group: "group",
  collapsed: "collapsed",
  hide: "hide",
  sort: "sort",
  dir: "dir",
  /** `subissues=hide` lists only top-level issues. */
  subissues: "subissues",
} as const;

export const defaultGroupBy: GroupBy = "status";
export const defaultSort: Sort = "updated";

export function defaultSortDirection(sort: BoardSort): SortDir {
  switch (sort) {
    case "updated":
    case "created":
    case "votes":
    case "number": {
      return "desc";
    }
    case "board":
    case "priority":
    case "urgency":
    case "impact":
    case "effort":
    case "due":
    case "title": {
      return "asc";
    }
  }
}

export function oppositeSortDirection(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : "asc";
}

export type DisplayOptions = {
  groupBy: GroupBy;
  collapsed: ReadonlySet<string>;
  hidden: ReadonlySet<RowProperty>;
  sort: Sort;
  boardSort: BoardSort;
  sortDir: SortDir;
  boardSortDir: SortDir;
  hasExplicitSort: boolean;
  showSubIssues: boolean;
};

export type DisplayChanges = Partial<{
  groupBy: GroupBy;
  collapsed: ReadonlySet<string>;
  hidden: ReadonlySet<RowProperty>;
  sort: Sort;
  boardSort: BoardSort;
  sortDir: SortDir;
  clearSort: boolean;
  showSubIssues: boolean;
}>;

export function hasSearchQuery(params: URLSearchParams): boolean {
  return (params.get("q")?.trim() ?? "") !== "";
}

/** Unknown values in a hand-edited link fall back to the defaults. */
export function readDisplay(params: URLSearchParams): DisplayOptions {
  const group = GroupBySchema.safeParse(params.get(displayParams.group));
  const sortParsed = SortSchema.safeParse(params.get(displayParams.sort));
  const boardSortParsed = BoardSortSchema.safeParse(
    params.get(displayParams.sort),
  );
  const sort = sortParsed.success ? sortParsed.data : defaultSort;
  const boardSort = boardSortParsed.success ? boardSortParsed.data : "board";
  const dir = SortDirSchema.safeParse(params.get(displayParams.dir));
  return {
    groupBy: group.success ? group.data : defaultGroupBy,
    collapsed: new Set(params.getAll(displayParams.collapsed)),
    hidden: new Set(
      params.getAll(displayParams.hide).flatMap((value) => {
        const parsed = RowPropertySchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
    sort,
    boardSort,
    sortDir: dir.success ? dir.data : defaultSortDirection(sort),
    boardSortDir: dir.success ? dir.data : defaultSortDirection(boardSort),
    hasExplicitSort: sortParsed.success || dir.success,
    showSubIssues: params.get(displayParams.subissues) !== "hide",
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

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
) {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

function applySortDirection(
  next: URLSearchParams,
  change: DisplayChanges,
  sortDir: SortDir,
  hasSearch: boolean,
) {
  const parsedListSort = SortSchema.safeParse(next.get(displayParams.sort));
  if (
    change.boardSort === undefined &&
    change.sort === undefined &&
    !parsedListSort.success
  ) {
    next.delete(displayParams.sort);
  }
  const activeSort: BoardSort =
    change.boardSort ??
    change.sort ??
    (parsedListSort.success ? parsedListSort.data : defaultSort);
  if (
    hasSearch &&
    activeSort === defaultSort &&
    change.boardSort === undefined
  ) {
    next.set(displayParams.sort, defaultSort);
  }
  if (activeSort === "board" || sortDir === defaultSortDirection(activeSort)) {
    next.delete(displayParams.dir);
  } else {
    next.set(displayParams.dir, sortDir);
  }
}

function applySortChanges(next: URLSearchParams, change: DisplayChanges) {
  if (change.clearSort === true) {
    next.delete(displayParams.sort);
    next.delete(displayParams.dir);
    return;
  }
  const hasSearch = hasSearchQuery(next);
  if (change.sort !== undefined) {
    if (hasSearch && change.sort === defaultSort) {
      next.set(displayParams.sort, change.sort);
    } else {
      setOrDelete(next, displayParams.sort, change.sort, defaultSort);
    }
    if (change.sortDir === undefined) next.delete(displayParams.dir);
  }
  if (change.boardSort !== undefined) {
    setOrDelete(next, displayParams.sort, change.boardSort, "board");
    if (change.sortDir === undefined) next.delete(displayParams.dir);
  }
  if (change.sortDir !== undefined) {
    applySortDirection(next, change, change.sortDir, hasSearch);
  }
}

/** The address with some display options changed; the rest are kept. */
export function writeDisplay(
  params: URLSearchParams,
  change: DisplayChanges,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (change.groupBy !== undefined) {
    setOrDelete(next, displayParams.group, change.groupBy, defaultGroupBy);
    // Group keys mean something else under another grouping.
    next.delete(displayParams.collapsed);
  }
  if (change.collapsed !== undefined) {
    setAll(next, displayParams.collapsed, [...change.collapsed].sort());
  }
  if (change.hidden !== undefined) {
    const { hidden } = change;
    setAll(
      next,
      displayParams.hide,
      rowProperties.filter((property) => hidden.has(property)),
    );
  }
  if (change.showSubIssues !== undefined) {
    setOrDelete(
      next,
      displayParams.subissues,
      change.showSubIssues ? "show" : "hide",
      "show",
    );
  }
  applySortChanges(next, change);
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

const triRank: Record<"high" | "medium" | "low", number> = {
  high: 1,
  medium: 2,
  low: 3,
};
const effortRank: Record<"xs" | "s" | "m" | "l" | "xl", number> = {
  xs: 1,
  s: 2,
  m: 3,
  l: 4,
  xl: 5,
};

function compareRankedNullable(
  left: number | null,
  right: number | null,
  sign: number,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  return right === null ? -1 : (left - right) * sign;
}

function compareNullableText(
  left: string | null,
  right: string | null,
  sign: number,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  return right === null ? -1 : left.localeCompare(right) * sign;
}

const issueSortComparators: Record<
  BoardSort,
  (a: Issue, b: Issue, sign: number) => number
> = {
  board: (a, b, sign) => (a.boardOrder - b.boardOrder) * sign,
  updated: (a, b, sign) => a.updatedAt.localeCompare(b.updatedAt) * sign,
  created: (a, b, sign) => a.createdAt.localeCompare(b.createdAt) * sign,
  priority: (a, b, sign) =>
    compareRankedNullable(
      a.priority === 0 ? null : a.priority,
      b.priority === 0 ? null : b.priority,
      sign,
    ),
  urgency: (a, b, sign) =>
    compareRankedNullable(
      a.urgency === null ? null : triRank[a.urgency],
      b.urgency === null ? null : triRank[b.urgency],
      sign,
    ),
  impact: (a, b, sign) =>
    compareRankedNullable(
      a.impact === null ? null : triRank[a.impact],
      b.impact === null ? null : triRank[b.impact],
      sign,
    ),
  effort: (a, b, sign) =>
    compareRankedNullable(
      a.effort === null ? null : effortRank[a.effort],
      b.effort === null ? null : effortRank[b.effort],
      sign,
    ),
  votes: (a, b, sign) => (a.voteCount - b.voteCount) * sign,
  due: (a, b, sign) => compareNullableText(a.dueDate, b.dueDate, sign),
  number: (a, b, sign) => (a.number - b.number) * sign,
  title: (a, b, sign) =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase()) * sign,
};

/** Client-side issue comparator matching `issue-list.ts` keyset ordering. */
export function compareIssuesBySort(
  a: Issue,
  b: Issue,
  sort: BoardSort,
  dir: SortDir,
): number {
  const sign = dir === "desc" ? -1 : 1;
  const diff = issueSortComparators[sort](a, b, sign);
  return diff === 0 ? a.id.localeCompare(b.id) : diff;
}
