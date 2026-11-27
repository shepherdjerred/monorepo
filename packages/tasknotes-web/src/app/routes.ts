import { addDays, isCivilDay, type CivilDay } from "#workspace/civil-day.ts";
import type { Destination } from "#workspace/workspace.ts";

export const TODAY: Destination = { kind: "section", section: "today" };

export type WorkspaceRoute = {
  screen: "tasks" | "browse" | "search" | "settings" | "missing";
  destination: Destination;
  taskId: string | null;
  query: string;
  includeCompleted: boolean;
  upcomingDay: CivilDay | null;
};

export function destinationPath(destination: Destination): string {
  return destination.kind === "section"
    ? `/${destination.section}`
    : `/${destination.kind}s/${encodeURIComponent(destination.id)}`;
}

function collectionDestination(
  name: string,
  encoded: string,
): Destination | undefined {
  try {
    const id = decodeURIComponent(encoded);
    switch (name) {
      case "projects":
        return { kind: "project", id };
      case "labels":
        return { kind: "label", id };
      case "filters":
        return { kind: "filter", id };
      default:
        return;
    }
  } catch (error: unknown) {
    if (!(error instanceof URIError)) throw error;
    return;
  }
}

export function readRoute(pathname: string, search: string): WorkspaceRoute {
  const params = new URLSearchParams(search);
  const date = params.get("date");
  const route: WorkspaceRoute = {
    screen: "tasks",
    destination: TODAY,
    taskId: params.get("task"),
    query: params.get("q") ?? "",
    includeCompleted: params.get("completed") === "1",
    upcomingDay: date !== null && isCivilDay(date) ? date : null,
  };
  const segments = pathname.split("/").filter(Boolean);
  const [name, encoded] = segments;
  if (segments.length <= 1) {
    switch (name) {
      case undefined:
      case "today":
        return route;
      case "inbox":
      case "upcoming":
      case "completed":
        return { ...route, destination: { kind: "section", section: name } };
      case "browse":
      case "search":
      case "settings":
        return { ...route, screen: name };
    }
  }
  if (name !== undefined && encoded !== undefined && segments.length === 2) {
    const destination = collectionDestination(name, encoded);
    if (destination !== undefined) return { ...route, destination };
  }
  return { ...route, screen: "missing" };
}

export function changeQuery(
  pathname: string,
  search: string,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

export function upcomingWeekOffset(
  current: CivilDay,
  selected: CivilDay | null,
): number {
  if (selected === null || selected < current) return 0;
  const elapsed = Date.parse(selected) - Date.parse(current);
  return Math.floor(elapsed / (7 * 86_400_000)) * 7;
}

export function upcomingPath(current: CivilDay, offset: number): string {
  return changeQuery("/upcoming", "", {
    date: offset === 0 ? null : addDays(current, offset),
  });
}
