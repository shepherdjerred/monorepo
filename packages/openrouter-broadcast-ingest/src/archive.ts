import {
  archiveObjectExists,
  uploadArchive,
  type ArchiveConfig,
} from "@shepherdjerred/llm-observability";

export type BroadcastArchiveStore = {
  exists: (key: string) => Promise<boolean>;
  put: (key: string, payload: string) => Promise<void>;
};

export function createBroadcastArchiveStore(
  config: ArchiveConfig,
): BroadcastArchiveStore {
  return {
    exists: (key) => archiveObjectExists(config, key),
    async put(key, payload) {
      const ref = await uploadArchive(config, key, payload);
      if (ref.status === "failed") {
        throw new Error(ref.error ?? `failed to archive ${key}`);
      }
    },
  };
}
