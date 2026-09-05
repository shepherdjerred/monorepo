import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  hasRunningExploreRunMarker,
  type ExploreRunMarker,
} from "#src/lib/explore/explore-run-markers.ts";

/** Refresh process-owned runs when another tab publishes a running marker. */
export function useMarkerDiscovery(
  activated: boolean,
  markers: ExploreRunMarker[],
  setActivated: Dispatch<SetStateAction<boolean>>,
  refetchActiveRuns: () => Promise<unknown>,
): void {
  useEffect(() => {
    if (!hasRunningExploreRunMarker(markers)) return;
    setActivated(true);
    if (activated) void refetchActiveRuns();
  }, [activated, markers, refetchActiveRuns, setActivated]);
}
