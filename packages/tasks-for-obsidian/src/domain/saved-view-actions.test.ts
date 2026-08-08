import { describe, expect, test } from "bun:test";

import {
  addSavedView,
  createSavedViewId,
  deleteSavedView,
  duplicateSavedView,
  moveSavedView,
  setSavedViewFavorite,
  updateSavedView,
} from "./saved-view-actions";
import type { SavedViewDefinition } from "./saved-view-actions";
import { createDefaultSavedViewPreferences } from "./saved-views";

function definition(name: string): SavedViewDefinition {
  return {
    name,
    symbol: "tray",
    tint: "#0a84ff",
    favorite: false,
    query: {
      projects: [],
      contexts: [],
      tags: [],
      statuses: [],
      priorities: [],
      completed: "active",
      missingFields: [],
    },
    presentation: {
      layout: "list",
      sort: { field: "deadline", direction: "ascending" },
      group: "none",
    },
  };
}

describe("saved-view lifecycle", () => {
  test("creates stable unique IDs from user-facing names", () => {
    expect(createSavedViewId("  Déjà Vu!  ", new Set())).toBe("deja-vu");
    expect(createSavedViewId("✨", new Set())).toBe("view");
    expect(createSavedViewId("Focus", new Set(["focus", "focus-2"]))).toBe(
      "focus-3",
    );
  });

  test("adds and edits a view while preserving identity and order", () => {
    const initial = createDefaultSavedViewPreferences();
    const added = addSavedView(initial, definition("Weekly Review"));

    expect(added.view.id).toBe("weekly-review");
    expect(added.view.order).toBe(2);

    const updated = updateSavedView(added.preferences, added.view.id, {
      ...definition("Friday Review"),
      favorite: true,
    });
    expect({
      id: updated.view.id,
      name: updated.view.name,
      favorite: updated.view.favorite,
      order: updated.view.order,
    }).toEqual({
      id: "weekly-review",
      name: "Friday Review",
      favorite: true,
      order: 2,
    });
  });

  test("duplicates immediately after the source with a unique copy", () => {
    const initial = createDefaultSavedViewPreferences();
    const first = duplicateSavedView(initial, "job-search");
    const second = duplicateSavedView(first.preferences, "job-search");

    expect({
      id: first.view.id,
      name: first.view.name,
      favorite: first.view.favorite,
    }).toEqual({
      id: "job-search-copy",
      name: "Job Search Copy",
      favorite: false,
    });
    expect({ id: second.view.id, name: second.view.name }).toEqual({
      id: "job-search-copy-2",
      name: "Job Search Copy 2",
    });
    expect(second.preferences.views.map((view) => view.order)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  test("reorders, favorites, and deletes without leaving order gaps", () => {
    const initial = createDefaultSavedViewPreferences();
    const moved = moveSavedView(initial, "school", "up");
    expect(moved.views.map((view) => view.id)).toEqual([
      "school",
      "job-search",
    ]);

    const unfavorited = setSavedViewFavorite(moved, "school", false);
    expect(unfavorited.views[0]?.favorite).toBe(false);

    const deleted = deleteSavedView(unfavorited, "school");
    expect(deleted.views.map((view) => [view.id, view.order])).toEqual([
      ["job-search", 0],
    ]);
  });

  test("fails loudly when a requested view does not exist", () => {
    const initial = createDefaultSavedViewPreferences();

    expect(() => deleteSavedView(initial, "missing")).toThrow("does not exist");
    expect(() => moveSavedView(initial, "missing", "up")).toThrow(
      "does not exist",
    );
    expect(() => duplicateSavedView(initial, "missing")).toThrow(
      "does not exist",
    );
  });
});
