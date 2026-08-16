import { useSyncExternalStore } from "react";
import { safeStorage } from "#src/lib/safe-storage";
import { DOWNLOAD_FLAG_KEY } from "#src/storage/keys";

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DOWNLOAD_FLAG_KEY || event.key === null) {
      listener();
    }
  };
  globalThis.addEventListener("storage", onStorage);
  return () => {
    globalThis.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): boolean {
  return safeStorage.getItem(DOWNLOAD_FLAG_KEY) === "true";
}

/**
 * Hidden devtools-only flag (`localStorage.download = "true"`) that reveals
 * stream download links. Replaces a 7-level prop drill.
 */
export function useDownloadEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
