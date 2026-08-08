import { describe, expect, test } from "bun:test";

import { updateSavedView } from "./saved-view-actions";
import {
  deriveJobSearchBoardSource,
  JOB_SEARCH_SAVED_VIEW_ID,
  jobSearchColumnKey,
  jobSearchMovePatch,
} from "./job-search-board";
import { createDefaultSavedViewPreferences } from "./saved-views";
import type { SavedView } from "./saved-views";
import type { Task } from "./types";
import { projectName, tagName, taskId } from "./types";

function makeTask(
  id: string,
  title: string,
  overrides: Partial<Task> = {},
): Task {
  return {
    id: taskId(id),
    path: `Tasks/${id}.md`,
    title,
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
    completeInstances: [],
    skippedInstances: [],
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    extraFields: {},
    ...overrides,
  };
}

function jobSearchView(): SavedView {
  const view = createDefaultSavedViewPreferences().views.find(
    (candidate) => candidate.id === JOB_SEARCH_SAVED_VIEW_ID,
  );
  if (view === undefined) {
    throw new Error("The default Job Search view is missing");
  }
  return view;
}

describe("deriveJobSearchBoardSource", () => {
  test("uses the editable Job Search query and presentation instead of the seed filter", () => {
    const defaults = createDefaultSavedViewPreferences();
    const existing = jobSearchView();
    const edited = updateSavedView(defaults, existing.id, {
      name: "Applications",
      symbol: existing.symbol,
      tint: existing.tint,
      favorite: existing.favorite,
      query: {
        ...existing.query,
        projects: [],
        tags: ["remote"],
      },
      presentation: {
        ...existing.presentation,
        sort: { field: "title", direction: "descending" },
      },
    }).preferences;
    const tasks = [
      makeTask("seed-project", "Seed project only", {
        projects: [projectName("[[2026 Job Search]]")],
      }),
      makeTask("remote-a", "Alpha", { tags: [tagName("remote")] }),
      makeTask("remote-z", "Zulu", { tags: [tagName("remote")] }),
    ];

    const source = deriveJobSearchBoardSource(
      tasks,
      edited.views,
      "2026-08-08",
    );

    expect(source?.view.name).toBe("Applications");
    expect(source?.tasks.map((task) => task.id)).toEqual([
      taskId("remote-z"),
      taskId("remote-a"),
    ]);
  });

  test("returns no board source after the bound saved view is deleted", () => {
    const views = createDefaultSavedViewPreferences().views.filter(
      (view) => view.id !== JOB_SEARCH_SAVED_VIEW_ID,
    );

    expect(deriveJobSearchBoardSource([], views, "2026-08-08")).toBeNull();
  });
});

describe("Job Search columns", () => {
  test("moves both the preferred custom field and fallback tag", () => {
    const task = makeTask("company", "Company", {
      tags: [tagName("identified"), tagName("remote")],
      extraFields: { company_status: "identified", source: "referral" },
    });

    const patch = jobSearchMovePatch(task, "applied");
    expect(patch).toEqual({
      tags: ["remote", "applied"],
      extraFields: { company_status: "applied", source: "referral" },
    });
    expect(
      jobSearchColumnKey({
        tags: patch.tags.map((tag) => tagName(tag)),
        extraFields: patch.extraFields,
      }),
    ).toBe("applied");
  });

  test("rejects an unknown destination", () => {
    expect(() =>
      jobSearchMovePatch(makeTask("company", "Company"), "offer"),
    ).toThrow("Unknown Job Search column: offer");
  });
});
