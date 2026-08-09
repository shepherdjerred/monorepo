import {
  SAVED_VIEW_PREFERENCES_VERSION,
  SavedViewPreferencesSchema,
  SavedViewSchema,
} from "./saved-views";
import type { SavedView, SavedViewPreferences } from "./saved-views";

export type SavedViewDefinition = Omit<SavedView, "id" | "order">;
export type SavedViewMoveDirection = "up" | "down";

function compareSavedViewOrder(a: SavedView, b: SavedView): number {
  return a.order - b.order || a.name.localeCompare(b.name);
}

export function sortSavedViews(views: readonly SavedView[]): SavedView[] {
  return [...views].sort(compareSavedViewOrder);
}

export function normalizeSavedViewOrder(
  views: readonly SavedView[],
): SavedView[] {
  return sortSavedViews(views).map((view, order) =>
    SavedViewSchema.parse({ ...view, order }),
  );
}

function baseIdForName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replaceAll(/[\u{0300}-\u{036F}]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 120)
    .replaceAll(/-+$/g, "");

  return normalized || "view";
}

export function createSavedViewId(
  name: string,
  existingIds: ReadonlySet<string>,
): string {
  const base = baseIdForName(name);
  if (!existingIds.has(base)) return base;

  let suffix = 2;
  while (existingIds.has(`${base}-${String(suffix)}`)) suffix += 1;
  return `${base}-${String(suffix)}`;
}

function parsePreferences(views: readonly SavedView[]): SavedViewPreferences {
  return SavedViewPreferencesSchema.parse({
    version: SAVED_VIEW_PREFERENCES_VERSION,
    views: normalizeSavedViewOrder(views),
  });
}

export function addSavedView(
  preferences: SavedViewPreferences,
  definition: SavedViewDefinition,
): { readonly preferences: SavedViewPreferences; readonly view: SavedView } {
  const ordered = normalizeSavedViewOrder(preferences.views);
  const view = SavedViewSchema.parse({
    ...definition,
    id: createSavedViewId(
      definition.name,
      new Set(ordered.map((item) => item.id)),
    ),
    order: ordered.length,
  });

  return {
    preferences: parsePreferences([...ordered, view]),
    view,
  };
}

export function updateSavedView(
  preferences: SavedViewPreferences,
  id: string,
  definition: SavedViewDefinition,
): { readonly preferences: SavedViewPreferences; readonly view: SavedView } {
  const existing = preferences.views.find((view) => view.id === id);
  if (existing === undefined) {
    throw new Error(`Saved view ${id} does not exist`);
  }

  const view = SavedViewSchema.parse({
    ...definition,
    id: existing.id,
    order: existing.order,
  });
  const views = preferences.views.map((candidate) =>
    candidate.id === id ? view : candidate,
  );

  return { preferences: parsePreferences(views), view };
}

function copyName(
  sourceName: string,
  existingNames: ReadonlySet<string>,
): string {
  let copyNumber = 1;
  let candidate: string;
  do {
    const suffix = copyNumber === 1 ? " Copy" : ` Copy ${String(copyNumber)}`;
    const prefix = sourceName.slice(0, 100 - suffix.length).trimEnd();
    candidate = `${prefix}${suffix}`;
    copyNumber += 1;
  } while (existingNames.has(candidate));
  return candidate;
}

export function duplicateSavedView(
  preferences: SavedViewPreferences,
  id: string,
): { readonly preferences: SavedViewPreferences; readonly view: SavedView } {
  const ordered = normalizeSavedViewOrder(preferences.views);
  const sourceIndex = ordered.findIndex((view) => view.id === id);
  const source = ordered[sourceIndex];
  if (source === undefined) {
    throw new Error(`Saved view ${id} does not exist`);
  }

  const name = copyName(source.name, new Set(ordered.map((view) => view.name)));
  const view = SavedViewSchema.parse({
    ...source,
    id: createSavedViewId(name, new Set(ordered.map((item) => item.id))),
    name,
    favorite: false,
    order: sourceIndex + 1,
  });
  const views = [
    ...ordered.slice(0, sourceIndex + 1),
    view,
    ...ordered.slice(sourceIndex + 1),
  ];

  return { preferences: parsePreferences(views), view };
}

export function deleteSavedView(
  preferences: SavedViewPreferences,
  id: string,
): SavedViewPreferences {
  if (!preferences.views.some((view) => view.id === id)) {
    throw new Error(`Saved view ${id} does not exist`);
  }

  return parsePreferences(preferences.views.filter((view) => view.id !== id));
}

export function moveSavedView(
  preferences: SavedViewPreferences,
  id: string,
  direction: SavedViewMoveDirection,
): SavedViewPreferences {
  const ordered = normalizeSavedViewOrder(preferences.views);
  const index = ordered.findIndex((view) => view.id === id);
  if (index === -1) throw new Error(`Saved view ${id} does not exist`);

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) {
    return parsePreferences(ordered);
  }

  const current = ordered[index];
  const target = ordered[targetIndex];
  if (current === undefined || target === undefined) {
    throw new Error("Saved-view ordering is internally inconsistent");
  }

  const reordered = [...ordered];
  reordered[index] = target;
  reordered[targetIndex] = current;

  return SavedViewPreferencesSchema.parse({
    version: SAVED_VIEW_PREFERENCES_VERSION,
    views: reordered.map((view, order) => ({ ...view, order })),
  });
}

export function setSavedViewFavorite(
  preferences: SavedViewPreferences,
  id: string,
  favorite: boolean,
): SavedViewPreferences {
  const existing = preferences.views.find((view) => view.id === id);
  if (existing === undefined) {
    throw new Error(`Saved view ${id} does not exist`);
  }

  return parsePreferences(
    preferences.views.map((view) =>
      view.id === id ? SavedViewSchema.parse({ ...view, favorite }) : view,
    ),
  );
}
