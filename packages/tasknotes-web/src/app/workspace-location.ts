import type { Task } from "@shepherdjerred/facet-protocol";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { changeQuery, readRoute } from "./routes.ts";

function openedFromList(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "fromTaskList") === true
  );
}

function resolveTaskId(
  requested: string | null,
  mapping: Readonly<Record<string, string>>,
): string | null {
  return requested === null || !Object.hasOwn(mapping, requested)
    ? requested
    : (mapping[requested] ?? requested);
}

export function useWorkspaceLocation(
  mapping: Readonly<Record<string, string>>,
  dirty: boolean,
) {
  const location = useLocation();
  const { pathname, search } = location;
  const navigate = useNavigate();
  const route = readRoute(pathname, search);
  const fromTaskList = openedFromList(location.state);
  const taskId = resolveTaskId(route.taskId, mapping);

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
    return changeQuery(pathname, search, { task: task.id });
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
    go(changeQuery(pathname, search, { task: null }), true);
  }

  useEffect(() => {
    if (dirty || route.taskId === null || taskId === route.taskId) return;
    void navigate(changeQuery(pathname, search, { task: taskId }), {
      state: { fromTaskList },
      replace: true,
    });
  }, [dirty, fromTaskList, navigate, pathname, route.taskId, search, taskId]);

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
