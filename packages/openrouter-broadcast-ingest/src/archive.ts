import {
  archiveObjectExists,
  readArchiveObject,
  uploadArchive,
  type ArchiveConfig,
} from "@shepherdjerred/llm-observability";

export type BroadcastArchiveStore = {
  exists: (key: string) => Promise<boolean>;
  get: (key: string) => Promise<string | undefined>;
  put: (key: string, payload: string) => Promise<void>;
};

export function createBroadcastArchiveStore(
  config: ArchiveConfig,
): BroadcastArchiveStore {
  return {
    exists: (key) => archiveObjectExists(config, key),
    get: (key) => readArchiveObject(config, key),
    async put(key, payload) {
      const ref = await uploadArchive(config, key, payload);
      if (ref.status === "failed") {
        throw new Error(ref.error ?? `failed to archive ${key}`);
      }
    },
  };
}
