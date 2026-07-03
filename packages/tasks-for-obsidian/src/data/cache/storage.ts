import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { TaskSchema } from "../../domain/schemas";
import type { Task } from "../../domain/types";

const KEYS = {
  TASKS: "tasks_cache",
  SETTINGS: "settings",
  MUTATION_QUEUE: "mutation_queue", // legacy (v1); migrated on first launch
  QUEUE_V2: "mutation_queue_v2",
  DEAD_LETTER: "dead_letter",
  ID_ALIASES: "id_aliases",
  SCHEMA_VERSION: "storage_schema_version",
  LAST_SYNC: "last_sync_time",
} as const;

export type Settings = {
  baseUrl: string;
  syncIntervalMs: number;
  offlineModeEnabled: boolean;
};

const SettingsSchema = z.object({
  baseUrl: z.string(),
  syncIntervalMs: z.number(),
  offlineModeEnabled: z.boolean(),
});

/**
 * Per-element salvage: one corrupt task must not discard the whole offline
 * cache (the old whole-array parse dropped everything). Pure and exported
 * for tests — AsyncStorage itself needs the native module.
 */
export function parseTaskCache(raw: string | null): Task[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tasks: Task[] = [];
    for (const item of parsed) {
      const result = TaskSchema.safeParse(item);
      if (result.success) tasks.push(result.data);
    }
    return tasks;
  } catch {
    return [];
  }
}

export const TypedStorage = {
  async getTasks(): Promise<Task[]> {
    return parseTaskCache(await AsyncStorage.getItem(KEYS.TASKS));
  },

  async setTasks(tasks: Task[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.TASKS, JSON.stringify(tasks));
  },

  async getSettings(): Promise<Settings | null> {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!raw) return null;
    try {
      const parsed = SettingsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },

  async setSettings(settings: Settings): Promise<void> {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  },

  async getMutationQueue(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.MUTATION_QUEUE);
  },

  async setMutationQueue(data: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.MUTATION_QUEUE, data);
  },

  async removeMutationQueue(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.MUTATION_QUEUE);
  },

  async getQueueV2(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.QUEUE_V2);
  },

  async setQueueV2(data: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.QUEUE_V2, data);
  },

  async getDeadLetter(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.DEAD_LETTER);
  },

  async setDeadLetter(data: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.DEAD_LETTER, data);
  },

  async getIdAliases(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.ID_ALIASES);
  },

  async setIdAliases(data: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.ID_ALIASES, data);
  },

  async getSchemaVersion(): Promise<number> {
    const raw = await AsyncStorage.getItem(KEYS.SCHEMA_VERSION);
    if (!raw) return 0;
    const v = Number(raw);
    return Number.isNaN(v) ? 0 : v;
  },

  async setSchemaVersion(version: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.SCHEMA_VERSION, String(version));
  },

  async getLastSyncTime(): Promise<number | null> {
    const raw = await AsyncStorage.getItem(KEYS.LAST_SYNC);
    if (!raw) return null;
    const time = Number(raw);
    return Number.isNaN(time) ? null : time;
  },

  async setLastSyncTime(time: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_SYNC, String(time));
  },

  async clear(): Promise<void> {
    await AsyncStorage.removeMany(Object.values(KEYS));
  },
};
