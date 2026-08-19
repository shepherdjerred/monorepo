import { useCallback, useEffect, useState } from "react";
import {
  EXPLORE_RUN_MARKERS_KEY,
  clearSettledExploreRunMarker,
  loadExploreRunMarkers,
  saveExploreRunMarkers,
  type ExploreRunMarker,
} from "#src/lib/explore-run-markers.ts";

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
      clearSettledExploreRunMarker(current, displayedConversationId),
    );
  }, [displayedConversationId, updateMarkers]);

  return { markers, updateMarkers };
}
