import { useSyncContext } from "../state/SyncContext";

export function useSync() {
  return useSyncContext();
}
