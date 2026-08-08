import { useCallback, useRef, useState } from "react";

import { savedViewRepository } from "../data/preferences/async-storage-saved-view-repository";
import {
  addSavedView,
  deleteSavedView,
  duplicateSavedView,
  moveSavedView,
  setSavedViewFavorite,
  updateSavedView,
} from "../domain/saved-view-actions";
import type {
  SavedViewDefinition,
  SavedViewMoveDirection,
} from "../domain/saved-view-actions";
import type { SavedView, SavedViewPreferences } from "../domain/saved-views";

function errorFromUnknown(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(`Saved-view operation failed: ${String(value)}`);
}

type PersistedMutation = {
  readonly preferences: SavedViewPreferences;
  readonly view?: SavedView | undefined;
};

export function useSavedViews() {
  const [preferences, setPreferences] = useState<SavedViewPreferences | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const requestId = useRef(0);
  const pendingSaves = useRef(0);

  const reload = useCallback(async (): Promise<boolean> => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setIsLoading(true);
    setError(null);

    try {
      const loaded = await savedViewRepository.load();
      if (requestId.current === currentRequest) {
        setPreferences(loaded);
        setIsLoading(false);
      }
      return true;
    } catch (error_: unknown) {
      if (requestId.current === currentRequest) {
        setError(errorFromUnknown(error_));
        setIsLoading(false);
      }
      return false;
    }
  }, []);

  const persist = useCallback(
    async (
      createMutation: (preferences: SavedViewPreferences) => PersistedMutation,
    ): Promise<SavedView | boolean> => {
      pendingSaves.current += 1;
      setIsSaving(true);
      setError(null);
      try {
        const saved = await savedViewRepository.update((current) => {
          const mutation = createMutation(current);
          return {
            preferences: mutation.preferences,
            value: mutation.view ?? true,
          };
        });
        setPreferences(saved.preferences);
        return saved.value;
      } catch (error_: unknown) {
        setError(errorFromUnknown(error_));
        return false;
      } finally {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) setIsSaving(false);
      }
    },
    [],
  );

  const createView = useCallback(
    async (definition: SavedViewDefinition): Promise<SavedView | null> => {
      const result = await persist((current) =>
        addSavedView(current, definition),
      );
      return typeof result === "boolean" ? null : result;
    },
    [persist],
  );

  const editView = useCallback(
    async (
      id: string,
      definition: SavedViewDefinition,
    ): Promise<SavedView | null> => {
      const result = await persist((current) =>
        updateSavedView(current, id, definition),
      );
      return typeof result === "boolean" ? null : result;
    },
    [persist],
  );

  const copyView = useCallback(
    async (id: string): Promise<SavedView | null> => {
      const result = await persist((current) =>
        duplicateSavedView(current, id),
      );
      return typeof result === "boolean" ? null : result;
    },
    [persist],
  );

  const removeView = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await persist((current) => ({
        preferences: deleteSavedView(current, id),
      }));
      return result === true;
    },
    [persist],
  );

  const reorderView = useCallback(
    async (id: string, direction: SavedViewMoveDirection): Promise<boolean> => {
      const result = await persist((current) => ({
        preferences: moveSavedView(current, id, direction),
      }));
      return result === true;
    },
    [persist],
  );

  const favoriteView = useCallback(
    async (id: string, favorite: boolean): Promise<boolean> => {
      const result = await persist((current) => ({
        preferences: setSavedViewFavorite(current, id, favorite),
      }));
      return result === true;
    },
    [persist],
  );

  return {
    preferences,
    views: preferences?.views ?? [],
    error,
    isLoading,
    isSaving,
    reload,
    createView,
    editView,
    copyView,
    removeView,
    reorderView,
    favoriteView,
  };
}
