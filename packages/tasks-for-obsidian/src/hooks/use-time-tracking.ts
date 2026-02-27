import { useTimeTrackingContext } from "../state/TimeTrackingContext";

export function useTimeTracking() {
  return useTimeTrackingContext();
}
