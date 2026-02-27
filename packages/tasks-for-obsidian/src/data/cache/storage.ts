import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { TaskSchema } from "../../domain/schemas";
import type { Task } from "../../domain/types";

const KEYS = {
  TASKS: "tasks_cache",
  SETTINGS: "settings",
  MUTATION_QUEUE: "mutation_queue",
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

export const TypedStorage = {
  async getTasks(): Promise<Task[]> {
    const raw = await AsyncStorage.getItem(KEYS.TASKS);
    if (!raw) return [];
    try {
      const parsed = z.array(TaskSchema).safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
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
    await AsyncStorage.multiRemove(Object.values(KEYS));
  },
};
