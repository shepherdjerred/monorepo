import { projectDisplayName, projectPath } from "tasknotes-types/v2";

import type { SavedView } from "../../domain/saved-views";
import { isActiveStatus } from "../../domain/status";
import type { Task } from "../../domain/types";

export type SavedViewItem = {
  readonly kind: "saved-view";
  readonly key: string;
  readonly view: SavedView;
  readonly count: number;
};

export type DimensionItem = {
  readonly kind: "dimension";
  readonly key: string;
  readonly dimension: "project" | "context" | "tag";
  /** Exact destination identity; `name` is display-only. */
  readonly value: string;
  readonly name: string;
  readonly count: number;
};

export type BrowseProject = {
  /** Canonical vault path, preserving distinct same-basename projects. */
  readonly identity: string;
  readonly name: string;
};

export type DestinationItem = {
  readonly kind: "destination";
  readonly key: string;
  readonly destination: "search" | "completed" | "reports" | "settings";
  readonly title: string;
  readonly subtitle: string;
  readonly icon: "search" | "check-circle" | "bar-chart-2" | "settings";
};

export type BrowseItem =
  | SavedViewItem
  | DimensionItem
  | DestinationItem
  | { readonly kind: "new-view"; readonly key: string }
  | {
      readonly kind: "empty";
      readonly key: string;
      readonly message: string;
    };

export type BrowseSection = {
  readonly title: string;
  readonly data: readonly BrowseItem[];
};

export function taskCountLabel(count: number, qualifier = "active"): string {
  return `${String(count)} ${qualifier} task${count === 1 ? "" : "s"}`;
}

export function savedViewTaskCountLabel(
  view: SavedView,
  count: number,
): string {
  switch (view.query.completed) {
    case "active":
      return taskCountLabel(count, "active");
    case "completed":
      return taskCountLabel(count, "completed");
    case "all":
      return taskCountLabel(count, "matching");
  }
}

export function activeTasksForDimension(
  tasks: readonly Task[],
  dimension: DimensionItem["dimension"],
  name: string,
): readonly Task[] {
  return tasks.filter((task) => {
    if (!isActiveStatus(task.status)) return false;
    switch (dimension) {
      case "project":
        return task.projects.some(
          (project) =>
            projectPath(String(project)).toLowerCase() ===
            projectPath(name).toLowerCase(),
        );
      case "context":
        return task.contexts.some((context) => String(context) === name);
      case "tag":
        return task.tags.some((tag) => String(tag) === name);
    }
  });
}

export function deriveBrowseProjects(tasks: readonly Task[]): BrowseProject[] {
  const projectsByIdentity = new Map<string, BrowseProject>();
  for (const task of tasks) {
    for (const project of task.projects) {
      const rawProject = String(project);
      const identity = projectPath(rawProject);
      const key = identity.toLowerCase();
      if (!projectsByIdentity.has(key)) {
        projectsByIdentity.set(key, {
          identity,
          name: projectDisplayName(rawProject),
        });
      }
    }
  }
  const projects = [...projectsByIdentity.values()];
  const nameCounts = new Map<string, number>();
  for (const project of projects) {
    const key = project.name.toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return projects
    .map((project) => ({
      ...project,
      name:
        (nameCounts.get(project.name.toLocaleLowerCase()) ?? 0) > 1
          ? project.identity
          : project.name,
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.identity.localeCompare(right.identity),
    );
}

type BuildBrowseSectionsOptions = {
  readonly views: readonly SavedView[];
  readonly viewCounts: ReadonlyMap<string, number>;
  readonly activeTasks: readonly Task[];
  readonly completedCount: number;
  readonly projects: readonly BrowseProject[];
  readonly contextNames: readonly string[];
  readonly tagNames: readonly string[];
};

function destination(
  key: string,
  item: Omit<DestinationItem, "kind" | "key">,
): DestinationItem {
  return { kind: "destination", key, ...item };
}

export function buildBrowseSections({
  views,
  viewCounts,
  activeTasks,
  completedCount,
  projects,
  contextNames,
  tagNames,
}: BuildBrowseSectionsOptions): BrowseSection[] {
  const savedItem = (view: SavedView, prefix: string): SavedViewItem => ({
    kind: "saved-view",
    key: `${prefix}-${view.id}`,
    view,
    count: viewCounts.get(view.id) ?? 0,
  });
  const dimensionItems = (
    dimension: DimensionItem["dimension"],
    names: readonly string[],
  ): readonly BrowseItem[] =>
    names.length === 0
      ? [
          {
            kind: "empty",
            key: `${dimension}-empty`,
            message: `No ${dimension}s yet`,
          },
        ]
      : names.map((name) => ({
          kind: "dimension",
          key: `${dimension}-${name}`,
          dimension,
          value: name,
          name,
          count: activeTasksForDimension(activeTasks, dimension, name).length,
        }));

  const projectItems: readonly BrowseItem[] =
    projects.length === 0
      ? [{ kind: "empty", key: "project-empty", message: "No projects yet" }]
      : projects.map((project) => ({
          kind: "dimension",
          key: `project-${project.identity.toLowerCase()}`,
          dimension: "project",
          value: project.identity,
          name: project.name,
          count: activeTasksForDimension(
            activeTasks,
            "project",
            project.identity,
          ).length,
        }));

  const sections: BrowseSection[] = [
    {
      title: "Find",
      data: [
        destination("search", {
          destination: "search",
          title: "Search",
          subtitle: "Find any task",
          icon: "search",
        }),
      ],
    },
  ];
  const favorites = views.filter((view) => view.favorite);
  if (favorites.length > 0) {
    sections.push({
      title: "Favorites",
      data: favorites.map((view) => savedItem(view, "favorite")),
    });
  }

  sections.push(
    {
      title: "Saved Views",
      data: [
        ...views.map((view) => savedItem(view, "view")),
        { kind: "new-view", key: "new-view" },
      ],
    },
    { title: "Projects", data: projectItems },
    { title: "Contexts", data: dimensionItems("context", contextNames) },
    { title: "Tags", data: dimensionItems("tag", tagNames) },
    {
      title: "History",
      data: [
        destination("completed", {
          destination: "completed",
          title: "Completed",
          subtitle: taskCountLabel(completedCount, "completed"),
          icon: "check-circle",
        }),
      ],
    },
    {
      title: "Insights",
      data: [
        destination("reports", {
          destination: "reports",
          title: "Reports",
          subtitle: "Review tracked time",
          icon: "bar-chart-2",
        }),
      ],
    },
    {
      title: "App",
      data: [
        destination("settings", {
          destination: "settings",
          title: "Settings",
          subtitle: "Sync, appearance, and feedback",
          icon: "settings",
        }),
      ],
    },
  );
  return sections;
}
