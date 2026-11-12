import { useMemo } from "react";
import type { BootstrapData } from "#client/data/api.ts";
import { parseDay } from "#client/due/dates.ts";
import { isDueFilter } from "#client/due/due-filter.ts";

export type SavedView = BootstrapData["views"][number];
/** What a view stores: `issues.list` input names plus `group` and `view`. */
export type ViewParams = Record<string, string | string[]>;

/** The address parameter that says which saved view a list was opened from. */
export const savedViewParam = "saved";

/**
 * List address parameters and the `issues.list` names a view stores them
 * under. Only these are stored: collapsed groups, hidden row properties and
 * the peek describe one screen, not the view.
 */
const singles = [
  ["project", "projectSlug"],
  ["creator", "creatorKey"],
  ["priority", "priority"],
  ["q", "search"],
  ["sort", "sort"],
  ["group", "group"],
] as const;
const lists = [
  ["state", "states"],
  ["label", "labels"],
] as const;

/** A relative due filter is stored as words the browser resolves. */
function dueParams(due: string): ViewParams {
  switch (due) {
    case "overdue": {
      return { overdue: "true" };
    }
    case "none": {
      return { hasDueDate: "false" };
    }
    case "today": {
      return { dueAfter: "today", dueBefore: "today" };
    }
    case "week": {
      return { dueAfter: "today", dueBefore: "week" };
    }
  }
  return { dueBefore: due };
}

function dueFromParams(params: ViewParams): string | undefined {
  const value = (key: string) => {
    const found = params[key];
    return typeof found === "string" ? found : undefined;
  };
  if (value("overdue") === "true") {
    return "overdue";
  }
  if (value("hasDueDate") === "false") {
    return "none";
  }
  const before = value("dueBefore");
  if (before === "today" && value("dueAfter") === "today") {
    return "today";
  }
  if (before === "week") {
    return "week";
  }
  return before !== undefined && parseDay(before) !== undefined
    ? before
    : undefined;
}

/**
 * The view parameters of a list address. `me` turns "My issues" into the
 * viewer's own key, so the stored view is a plain `issues.list` filter.
 */
export function viewParamsFrom(
  search: URLSearchParams,
  scope: { board: boolean; teamKey: string | undefined; me: string },
): ViewParams {
  const params: ViewParams = {};
  if (scope.teamKey !== undefined) {
    params["teamKey"] = scope.teamKey;
  }
  for (const [url, stored] of singles) {
    const value = search.get(url);
    if (value !== null && value !== "") {
      params[stored] = value;
    }
  }
  for (const [url, stored] of lists) {
    const values = search.getAll(url);
    if (values.length > 0) {
      params[stored] = [...values].sort();
    }
  }
  const assignee =
    search.get("mine") === "true" ? scope.me : search.get("assignee");
  if (assignee !== null) {
    params["assigneeKey"] = assignee;
  }
  if (search.get("archived") === "true") {
    params["includeArchived"] = "true";
  }
  if (search.get("subissues") === "hide") {
    params["hasParent"] = "false";
  }
  const due = search.get("due");
  if (due !== null && isDueFilter(due)) {
    Object.assign(params, dueParams(due));
  }
  if (scope.board) {
    params["view"] = "board";
  }
  return params;
}

/** The address a view opens: its page, its team (or the current one), its filters. */
export function viewUrl(
  view: Pick<SavedView, "id" | "params">,
  scope: { teamKey: string; me: string },
) {
  const { params } = view;
  const search = new URLSearchParams();
  const text = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  search.set("team", text("teamKey") ?? scope.teamKey);
  for (const [url, stored] of singles) {
    const value = text(stored);
    if (value !== undefined) {
      search.set(url, value);
    }
  }
  for (const [url, stored] of lists) {
    const value = params[stored];
    for (const item of typeof value === "string" ? [value] : (value ?? [])) {
      search.append(url, item);
    }
  }
  const assignee = text("assigneeKey");
  if (assignee === scope.me) {
    search.set("mine", "true");
  } else if (assignee !== undefined) {
    search.set("assignee", assignee);
  }
  if (text("includeArchived") === "true") {
    search.set("archived", "true");
  }
  if (text("hasParent") === "false") {
    search.set("subissues", "hide");
  }
  const due = dueFromParams(params);
  if (due !== undefined) {
    search.set("due", due);
  }
  search.set(savedViewParam, view.id);
  return `/${text("view") === "board" ? "board" : "issues"}?${search.toString()}`;
}

function canonical(params: ViewParams) {
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .map((key) => {
        const value = params[key];
        return [key, Array.isArray(value) ? [...value].sort() : value];
      }),
  );
}

/**
 * Whether the list shown is exactly the view: the same filters and
 * display. A global view matches in any team.
 */
export function viewMatches(view: SavedView, current: ViewParams) {
  const { teamKey: _team, ...rest } = current;
  const compared = view.params["teamKey"] === undefined ? rest : current;
  return canonical(view.params) === canonical(compared);
}

/** A list with nothing but its team set has nothing to save. */
export function hasViewParams(current: ViewParams) {
  return Object.keys(current).some((key) => key !== "teamKey");
}

/** The views the sidebar lists for the team in view. */
export function useVisibleViews(
  bootstrap: BootstrapData | undefined,
  teamKey: string | undefined,
) {
  const views = bootstrap?.views;
  return useMemo(() => visibleViews(views ?? [], teamKey), [views, teamKey]);
}

/** A team's views and the global ones, in the shared order. */
export function visibleViews(
  views: readonly SavedView[],
  teamKey: string | undefined,
) {
  return [...views]
    .filter((view) => view.teamKey === null || view.teamKey === teamKey)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * The order after moving one view `delta` places among the shown ones.
 * Every view keeps its place in the full order, as `views.reorder` needs.
 */
export function moveView(
  all: readonly SavedView[],
  shown: readonly SavedView[],
  id: string,
  delta: number,
): string[] | undefined {
  const index = shown.findIndex((view) => view.id === id);
  const target = shown[index + delta];
  return index === -1 || target === undefined
    ? undefined
    : reorderTo(all, id, target.id);
}

/** The full order with `id` placed where `target` is now. */
export function reorderTo(
  all: readonly SavedView[],
  id: string,
  target: string,
): string[] | undefined {
  const ids = [...all]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((view) => view.id);
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from === -1 || to === -1 || from === to) {
    return undefined;
  }
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  return ids;
}

/** A global view applies to whichever team is shown, so it stores none. */
export function scopedParams(params: ViewParams, teamKey: string | null) {
  const { teamKey: _team, ...rest } = params;
  return teamKey === null ? rest : { ...rest, teamKey };
}
