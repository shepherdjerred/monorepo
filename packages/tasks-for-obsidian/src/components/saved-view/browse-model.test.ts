import { describe, expect, test } from "bun:test";

import { createDefaultSavedViewPreferences } from "../../domain/saved-views";
import { TaskSchema } from "../../domain/schemas";
import {
  activeTasksForDimension,
  buildBrowseSections,
  deriveBrowseProjects,
  savedViewTaskCountLabel,
} from "./browse-model";

function defaultView() {
  const view = createDefaultSavedViewPreferences().views[0];
  if (view === undefined) {
    throw new Error("The default saved view is missing");
  }
  return view;
}

describe("savedViewTaskCountLabel", () => {
  test("describes the completion population represented by the view", () => {
    const active = defaultView();
    const completed = {
      ...active,
      query: { ...active.query, completed: "completed" as const },
    };
    const all = {
      ...active,
      query: { ...active.query, completed: "all" as const },
    };

    expect(savedViewTaskCountLabel(active, 1)).toBe("1 active task");
    expect(savedViewTaskCountLabel(completed, 2)).toBe("2 completed tasks");
    expect(savedViewTaskCountLabel(all, 3)).toBe("3 matching tasks");
  });
});

describe("activeTasksForDimension", () => {
  test("matches Browse counts to active project destinations", () => {
    const tasks = [
      TaskSchema.parse({
        id: "active.md",
        title: "Active",
        projects: ["[[Projects/Work]]"],
      }),
      TaskSchema.parse({
        id: "done.md",
        title: "Done",
        status: "done",
        projects: ["Work"],
      }),
      TaskSchema.parse({
        id: "other.md",
        title: "Other",
        projects: ["Personal"],
      }),
    ];

    expect(
      activeTasksForDimension(tasks, "project", "Projects/Work").map(
        (task) => task.title,
      ),
    ).toEqual(["Active"]);
  });

  test("keeps projects with the same basename as exact distinct destinations", () => {
    const tasks = [
      TaskSchema.parse({
        id: "areas-work.md",
        title: "Area work",
        projects: ["[[Areas/Work]]"],
      }),
      TaskSchema.parse({
        id: "projects-work.md",
        title: "Project work",
        projects: ["[[Projects/Work]]"],
      }),
    ];
    const projects = deriveBrowseProjects(tasks);

    expect(projects).toEqual([
      { identity: "Areas/Work", name: "Areas/Work" },
      { identity: "Projects/Work", name: "Projects/Work" },
    ]);
    expect(
      activeTasksForDimension(tasks, "project", "Areas/Work").map(
        (task) => task.title,
      ),
    ).toEqual(["Area work"]);
    expect(
      activeTasksForDimension(tasks, "project", "Projects/Work").map(
        (task) => task.title,
      ),
    ).toEqual(["Project work"]);

    const projectSection = buildBrowseSections({
      views: [],
      viewCounts: new Map(),
      activeTasks: tasks,
      completedCount: 0,
      projects,
      contextNames: [],
      tagNames: [],
    }).find((section) => section.title === "Projects");
    if (projectSection === undefined) {
      throw new Error("The Projects section is missing");
    }
    expect(projectSection.data).toEqual([
      {
        kind: "dimension",
        key: "project-areas/work",
        dimension: "project",
        value: "Areas/Work",
        name: "Areas/Work",
        count: 1,
      },
      {
        kind: "dimension",
        key: "project-projects/work",
        dimension: "project",
        value: "Projects/Work",
        name: "Projects/Work",
        count: 1,
      },
    ]);
  });
});
