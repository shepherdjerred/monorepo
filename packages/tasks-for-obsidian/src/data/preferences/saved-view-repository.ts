import {
  createDefaultSavedViewPreferences,
  decodeSavedViewPreferences,
  encodeSavedViewPreferences,
} from "../../domain/saved-views";
import type { SavedViewPreferences } from "../../domain/saved-views";

export const SAVED_VIEW_PREFERENCES_STORAGE_KEY = "saved_view_preferences";

export type SavedViewPreferenceStorage = {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
};

export type SavedViewRepositoryMutation<Value> = {
  readonly preferences: SavedViewPreferences;
  readonly value: Value;
};

export class SavedViewRepository {
  private operationLocked = false;
  private readonly operationWaiters: (() => void)[] = [];

  public constructor(private readonly storage: SavedViewPreferenceStorage) {}

  public async load(): Promise<SavedViewPreferences> {
    return this.enqueue(() => this.loadCurrent());
  }

  public async save(
    preferences: SavedViewPreferences,
  ): Promise<SavedViewPreferences> {
    return this.enqueue(() => this.saveCurrent(preferences));
  }

  /**
   * Atomically derives and persists a mutation from the latest stored value.
   * All repository instances used by a screen share this singleton, so
   * overlapping hooks cannot overwrite each other's whole-preferences writes.
   */
  public async update<Value>(
    mutate: (
      preferences: SavedViewPreferences,
    ) => SavedViewRepositoryMutation<Value>,
  ): Promise<SavedViewRepositoryMutation<Value>> {
    return this.enqueue(async () => {
      const current = await this.loadCurrent();
      const mutation = mutate(current);
      const preferences = await this.saveCurrent(mutation.preferences);
      return { preferences, value: mutation.value };
    });
  }

  private async loadCurrent(): Promise<SavedViewPreferences> {
    const raw = await this.storage.getItem(SAVED_VIEW_PREFERENCES_STORAGE_KEY);

    if (raw === null) {
      const defaults = createDefaultSavedViewPreferences();
      await this.storage.setItem(
        SAVED_VIEW_PREFERENCES_STORAGE_KEY,
        encodeSavedViewPreferences(defaults),
      );
      return defaults;
    }

    const decoded = decodeSavedViewPreferences(raw);
    if (decoded.migrated) {
      await this.storage.setItem(
        SAVED_VIEW_PREFERENCES_STORAGE_KEY,
        encodeSavedViewPreferences(decoded.preferences),
      );
    }

    return decoded.preferences;
  }

  private async saveCurrent(
    preferences: SavedViewPreferences,
  ): Promise<SavedViewPreferences> {
    const encoded = encodeSavedViewPreferences(preferences);
    await this.storage.setItem(SAVED_VIEW_PREFERENCES_STORAGE_KEY, encoded);
    return decodeSavedViewPreferences(encoded).preferences;
  }

  private async enqueue<Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> {
    await this.acquireOperationLock();
    try {
      return await operation();
    } finally {
      this.releaseOperationLock();
    }
  }

  private async acquireOperationLock(): Promise<void> {
    if (!this.operationLocked) {
      this.operationLocked = true;
      return;
    }
    await new Promise<void>((resolve) => {
      this.operationWaiters.push(resolve);
    });
  }

  private releaseOperationLock(): void {
    const next = this.operationWaiters.shift();
    if (next === undefined) {
      this.operationLocked = false;
      return;
    }
    next();
  }
}
