import { describe, expect, test } from "bun:test";

import {
  SAVED_VIEW_PREFERENCES_VERSION,
  createDefaultSavedViewPreferences,
  decodeSavedViewPreferences,
  encodeSavedViewPreferences,
} from "../../domain/saved-views";
import type { SavedViewPreferences } from "../../domain/saved-views";
import {
  duplicateSavedView,
  setSavedViewFavorite,
} from "../../domain/saved-view-actions";
import {
  SAVED_VIEW_PREFERENCES_STORAGE_KEY,
  SavedViewRepository,
} from "./saved-view-repository";
import type { SavedViewPreferenceStorage } from "./saved-view-repository";

class MemoryStorage implements SavedViewPreferenceStorage {
  private readonly values = new Map<string, string>();
  public readonly writes: { readonly key: string; readonly value: string }[] =
    [];

  public constructor(initialValue?: string) {
    if (initialValue !== undefined) {
      this.values.set(SAVED_VIEW_PREFERENCES_STORAGE_KEY, initialValue);
    }
  }

  public async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.writes.push({ key, value });
  }
}

describe("SavedViewRepository", () => {
  test("seeds and persists the built-in views on first load", async () => {
    const storage = new MemoryStorage();
    const repository = new SavedViewRepository(storage);

    const preferences = await repository.load();

    expect(preferences).toEqual(createDefaultSavedViewPreferences());
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]?.key).toBe(SAVED_VIEW_PREFERENCES_STORAGE_KEY);
    expect(
      decodeSavedViewPreferences(storage.writes[0]?.value ?? "").preferences,
    ).toEqual(preferences);
  });

  test("preserves edits and deletions instead of re-seeding built-ins", async () => {
    const storage = new MemoryStorage();
    const repository = new SavedViewRepository(storage);
    const defaults = await repository.load();
    const jobSearch = defaults.views[0];
    if (jobSearch === undefined) {
      throw new Error("The default Job Search view is missing");
    }

    const edited: SavedViewPreferences = {
      version: SAVED_VIEW_PREFERENCES_VERSION,
      views: [{ ...jobSearch, name: "Career", favorite: false }],
    };
    await repository.save(edited);

    expect(await repository.load()).toEqual(edited);
    expect(storage.writes).toHaveLength(2);
  });

  test("loads current data without rewriting storage", async () => {
    const preferences = createDefaultSavedViewPreferences();
    const storage = new MemoryStorage(encodeSavedViewPreferences(preferences));
    const repository = new SavedViewRepository(storage);

    expect(await repository.load()).toEqual(preferences);
    expect(storage.writes).toHaveLength(0);
  });

  test("persists a migrated legacy value in the current format", async () => {
    const storage = new MemoryStorage(
      JSON.stringify({
        version: 0,
        views: [
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
    const repository = new SavedViewRepository(storage);

    const preferences = await repository.load();

    expect(preferences.version).toBe(SAVED_VIEW_PREFERENCES_VERSION);
    expect(preferences.views[0]?.symbol).toBe("book.closed");
    expect(storage.writes).toHaveLength(1);
    expect(
      decodeSavedViewPreferences(storage.writes[0]?.value ?? "").migrated,
    ).toBe(false);
  });

  test("rejects bad stored data without overwriting it", async () => {
    const raw = JSON.stringify({
      version: SAVED_VIEW_PREFERENCES_VERSION,
      views: [{ id: "broken" }],
    });
    const storage = new MemoryStorage(raw);
    const repository = new SavedViewRepository(storage);

    await expect(repository.load()).rejects.toThrow();
    expect(storage.writes).toHaveLength(0);
    expect(await storage.getItem(SAVED_VIEW_PREFERENCES_STORAGE_KEY)).toBe(raw);
  });

  test("serializes concurrent mutations against the latest stored preferences", async () => {
    const storage = new MemoryStorage();
    const repository = new SavedViewRepository(storage);
    await repository.load();

    await Promise.all([
      repository.update((current) => ({
        preferences: setSavedViewFavorite(current, "job-search", false),
        value: "favorite",
      })),
      repository.update((current) => {
        const duplicated = duplicateSavedView(current, "school");
        return {
          preferences: duplicated.preferences,
          value: duplicated.view.id,
        };
      }),
    ]);

    const saved = await repository.load();
    expect(saved.views.find((view) => view.id === "job-search")?.favorite).toBe(
      false,
    );
    expect(saved.views.map((view) => view.id)).toContain("school-copy");
  });
});
