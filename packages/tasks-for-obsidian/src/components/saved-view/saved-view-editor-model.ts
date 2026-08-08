import type { SavedViewDefinition } from "../../domain/saved-view-actions";
import {
  SavedViewPresentationSchema,
  SavedViewSchema,
} from "../../domain/saved-views";
import type {
  SavedView,
  SavedViewPresentation,
  SavedViewQuery,
} from "../../domain/saved-views";
import type { TaskStatus } from "../../domain/status";

export const SAVED_VIEW_STATUS_OPTIONS: readonly TaskStatus[] = [
  "open",
  "in-progress",
  "waiting",
  "delegated",
  "done",
  "cancelled",
];

export const SAVED_VIEW_COMPLETION_OPTIONS: readonly {
  readonly value: SavedViewQuery["completed"];
  readonly label: string;
}[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

export const SAVED_VIEW_TINT_OPTIONS = [
  "#0a84ff",
  "#6366f1",
  "#af52de",
  "#ff2d55",
  "#ff9500",
  "#22c55e",
] as const;

export const SAVED_VIEW_SORT_OPTIONS: readonly {
  readonly value: SavedViewPresentation["sort"]["field"];
  readonly label: string;
}[] = [
  { value: "scheduled", label: "Planned" },
  { value: "deadline", label: "Deadline" },
  { value: "priority", label: "Priority" },
  { value: "title", label: "Title" },
  { value: "created", label: "Created" },
  { value: "completed", label: "Completed" },
];

function blankDefinition(): SavedViewDefinition {
  const view = SavedViewSchema.parse({
    id: "draft",
    name: "New View",
    symbol: "tray",
    tint: "#0a84ff",
    favorite: false,
    order: 0,
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
  });
  const { id: _id, order: _order, ...definition } = view;
  // A draft form may temporarily be invalid. Starting empty lets typing
  // replace the placeholder instead of appending to a synthetic name.
  return { ...definition, name: "" };
}

export function definitionFromSavedView(
  view: SavedView | null,
): SavedViewDefinition {
  if (view === null) return blankDefinition();
  const { id: _id, order: _order, ...definition } = view;
  return definition;
}

export function updateSavedViewPresentationSort(
  presentation: SavedViewPresentation,
  field: SavedViewPresentation["sort"]["field"],
): SavedViewPresentation {
  return SavedViewPresentationSchema.parse({
    ...presentation,
    sort: { ...presentation.sort, field },
  });
}
