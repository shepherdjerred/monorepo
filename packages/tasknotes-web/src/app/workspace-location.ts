import type { Task } from "@shepherdjerred/facet-protocol";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Destination } from "#workspace/workspace.ts";
import { changeQuery, destinationPath, readRoute } from "./routes.ts";

function openedFromList(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "fromTaskList") === true
  );
}

function resolveId(
  requested: string,
  mapping: Readonly<Record<string, string>>,
): string {
  return Object.hasOwn(mapping, requested)
    ? (mapping[requested] ?? requested)
    : requested;
}

function resolveDestination(
  requested: Destination,
  mapping: Readonly<Record<string, string>>,
): Destination {
  if (requested.kind === "section") return requested;
  const id = resolveId(requested.id, mapping);
  return id === requested.id ? requested : { ...requested, id };
}

export function useWorkspaceLocation(
  mapping: Readonly<Record<string, string>>,
  dirty: boolean,
) {
  const location = useLocation();
  const { pathname, search, hash } = location;
  const navigate = useNavigate();
  const requestedRoute = readRoute(pathname, search);
  const destination = resolveDestination(requestedRoute.destination, mapping);
  const canonicalPath =
    destination === requestedRoute.destination
      ? pathname
      : destinationPath(destination);
  const route = { ...requestedRoute, destination };
  const fromTaskList = openedFromList(location.state);
  const taskId =
    route.taskId === null ? null : resolveId(route.taskId, mapping);

  function go(path: string, replace = false): void {
    void navigate(path, { replace });
  }

  function changeSearch(query: string): void {
    const inSearch = route.screen === "search";
    go(
      changeQuery("/search", inSearch ? search : "", { q: query, task: null }),
      inSearch,
    );
  }

  function showSearch(): void {
    if (route.screen === "search") {
      document
        .querySelector<HTMLInputElement>("main input[type=search]")
        ?.focus();
      return;
    }
    go("/search");
  }

  function taskHref(task: Task): string {
    return changeQuery(canonicalPath, search, { task: task.id });
  }

  function openTask(task: Task): void {
    void navigate(taskHref(task), {
      state: { fromTaskList: route.taskId === null || fromTaskList },
    });
  }

  function closeTask(): void {
    if (fromTaskList) {
      void navigate(-1);
      return;
    }
    go(changeQuery(canonicalPath, search, { task: null }), true);
  }

  useEffect(() => {
    if (dirty || (canonicalPath === pathname && taskId === route.taskId))
      return;
    const target =
      taskId === route.taskId
        ? `${canonicalPath}${search}`
        : changeQuery(canonicalPath, search, { task: taskId });
    void navigate(`${target}${hash}`, {
      state: { fromTaskList },
      replace: true,
    });
  }, [
    canonicalPath,
    dirty,
    fromTaskList,
    hash,
    navigate,
    pathname,
    route.taskId,
    search,
    taskId,
  ]);

  return {
    route,
    search,
    taskId,
    go,
    changeSearch,
    showSearch,
    taskHref,
    openTask,
    closeTask,
  };
}
