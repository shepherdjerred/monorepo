import { describe, expect, test } from "bun:test";

import {
  SAVED_VIEW_PREFERENCES_VERSION,
  SavedViewPreferencesSchema,
  SavedViewSchema,
  createDefaultSavedViewPreferences,
  decodeSavedViewPreferences,
  encodeSavedViewPreferences,
} from "./saved-views";
import type { SavedView } from "./saved-views";

function completeSavedView(): SavedView {
  return {
    id: "focus-this-week",
    name: "Focus This Week",
    symbol: "scope",
    tint: "#0a84ff",
    favorite: false,
    order: 7,
    query: {
      projects: ["Work"],
      contexts: ["desk"],
      tags: ["focus"],
      statuses: ["open", "in-progress"],
      priorities: ["highest", "high"],
      text: "launch",
      completed: "all",
      missingFields: ["deadline", "estimate"],
      scheduled: { startOffsetDays: 0, endOffsetDays: 7 },
      deadline: { endOffsetDays: 14 },
    },
    presentation: {
      layout: "list",
      sort: { field: "priority", direction: "ascending" },
      group: "project",
    },
  };
}

describe("SavedViewSchema", () => {
  test("parses the complete identity, query, and presentation contract", () => {
    expect(SavedViewSchema.parse(completeSavedView())).toEqual(
      completeSavedView(),
    );
  });

  test("requires a meaningful relative day range", () => {
    const view = completeSavedView();

    expect(() =>
      SavedViewSchema.parse({
        ...view,
        query: { ...view.query, scheduled: {} },
      }),
    ).toThrow("at least one bound");

    expect(() =>
      SavedViewSchema.parse({
        ...view,
        query: {
          ...view.query,
          scheduled: { startOffsetDays: 8, endOffsetDays: 2 },
        },
      }),
    ).toThrow("must not be after");
  });

  test("rejects presentation options the list renderer does not implement", () => {
    const view = completeSavedView();

    expect(() =>
      SavedViewSchema.parse({
        ...view,
        presentation: {
          layout: "board",
          sort: view.presentation.sort,
          group: "status",
        },
      }),
    ).toThrow();

    expect(() =>
      SavedViewSchema.parse({
        ...view,
        presentation: {
          layout: "calendar",
          sort: view.presentation.sort,
          group: "none",
          calendarAxis: "scheduled",
        },
      }),
    ).toThrow();

    expect(() =>
      SavedViewSchema.parse({
        ...view,
        presentation: {
          ...view.presentation,
          density: "compact",
        },
      }),
    ).toThrow();
  });

  test("rejects unknown fields instead of silently stripping them", () => {
    expect(() =>
      SavedViewSchema.parse({ ...completeSavedView(), unknown: true }),
    ).toThrow();
  });
});

describe("SavedViewPreferencesSchema", () => {
  test("seeds the current Job Search and School views", () => {
    const preferences = createDefaultSavedViewPreferences();

    expect(preferences.version).toBe(SAVED_VIEW_PREFERENCES_VERSION);
    expect(
      preferences.views.map((view) => ({
        id: view.id,
        name: view.name,
        tint: view.tint,
      })),
    ).toEqual([
      { id: "job-search", name: "Job Search", tint: "#6366f1" },
      { id: "school", name: "School", tint: "#22c55e" },
    ]);
    expect(preferences.views[0]?.query.projects).toEqual([
      "[[2026 Job Search]]",
    ]);
    expect(preferences.views[1]?.query.contexts).toEqual(["school"]);
  });

  test("rejects duplicate IDs and ordering values", () => {
    const view = completeSavedView();

    expect(() =>
      SavedViewPreferencesSchema.parse({
        version: SAVED_VIEW_PREFERENCES_VERSION,
        views: [view, { ...view, name: "Duplicate" }],
      }),
    ).toThrow("duplicated");

    expect(() =>
      SavedViewPreferencesSchema.parse({
        version: SAVED_VIEW_PREFERENCES_VERSION,
        views: [view, { ...view, id: "another-view" }],
      }),
    ).toThrow("duplicated");
  });
});

describe("saved-view preference encoding", () => {
  test("round-trips current preferences without migration", () => {
    const preferences = createDefaultSavedViewPreferences();
    const decoded = decodeSavedViewPreferences(
      encodeSavedViewPreferences(preferences),
    );

    expect(decoded).toEqual({ preferences, migrated: false });
  });

  test("migrates the legacy hard-coded view shape", () => {
    const decoded = decodeSavedViewPreferences(
      JSON.stringify({
        version: 0,
        views: [
          {
            id: "job-search",
            name: "Job Search",
            icon: "briefcase",
            filter: {
              projects: ["[[2026 Job Search]]"],
              hasNoDueDate: true,
            },
            color: "#6366f1",
          },
          {
            id: "school",
            name: "School",
            icon: "book-open",
            filter: { contexts: ["school"] },
            color: "#22c55e",
          },
        ],
      }),
    );

    expect(decoded.migrated).toBe(true);
    expect(decoded.preferences.version).toBe(SAVED_VIEW_PREFERENCES_VERSION);
    expect(decoded.preferences.views[0]?.symbol).toBe("briefcase");
    expect(decoded.preferences.views[0]?.query.missingFields).toEqual([
      "deadline",
    ]);
    expect(decoded.preferences.views[1]?.symbol).toBe("book.closed");
    expect(decoded.preferences.views[1]?.order).toBe(1);
  });

  test("fails loudly for malformed JSON and unsupported versions", () => {
    expect(() => decodeSavedViewPreferences("not JSON")).toThrow();
    expect(() =>
      decodeSavedViewPreferences(JSON.stringify({ version: 99, views: [] })),
    ).toThrow("Unsupported saved-view preferences version: 99");
  });

  test("fails loudly for malformed current data", () => {
    expect(() =>
      decodeSavedViewPreferences(
        JSON.stringify({
          version: SAVED_VIEW_PREFERENCES_VERSION,
          views: [{ id: "missing-everything-else" }],
        }),
      ),
    ).toThrow();
  });
});
