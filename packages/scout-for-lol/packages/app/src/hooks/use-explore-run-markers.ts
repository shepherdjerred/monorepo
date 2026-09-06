import { useCallback, useEffect, useState } from "react";
import type { ExploreMessage } from "@scout-for-lol/data";
import {
  EXPLORE_RUN_MARKERS_KEY,
  clearFailedExploreRunMarker,
  clearVisibleExploreRunMarker,
  loadExploreRunMarkers,
  saveExploreRunMarkers,
  type ExploreRunMarker,
} from "#src/lib/explore/explore-run-markers.ts";

function initialMarkers(): ExploreRunMarker[] {
  return loadExploreRunMarkers(globalThis.localStorage);
}

/** Persist and cross-tab synchronize opaque Explore run status markers. */
export function useExploreRunMarkers(displayedConversationId: string | null) {
  const [markers, setMarkers] = useState<ExploreRunMarker[]>(initialMarkers);
  const updateMarkers = useCallback(
    (update: (current: ExploreRunMarker[]) => ExploreRunMarker[]) => {
      setMarkers((current) => update(current));
    },
    [],
  );
  const acknowledgeVisibleAnswer = useCallback(
    (conversationId: string, messages: ExploreMessage[]): void => {
      updateMarkers((current) =>
        clearVisibleExploreRunMarker(current, conversationId, messages),
      );
    },
    [updateMarkers],
  );

  useEffect(() => {
    saveExploreRunMarkers(globalThis.localStorage, markers);
  }, [markers]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === EXPLORE_RUN_MARKERS_KEY) {
        setMarkers(loadExploreRunMarkers(globalThis.localStorage));
      }
    };
    globalThis.addEventListener("storage", onStorage);
    return () => {
      globalThis.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (displayedConversationId === null) return;
    updateMarkers((current) =>
      clearFailedExploreRunMarker(current, displayedConversationId),
    );
  }, [displayedConversationId, updateMarkers]);

  return { markers, updateMarkers, acknowledgeVisibleAnswer };
}
