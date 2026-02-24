import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { taskSchema } from "../../domain/schemas";
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

const settingsSchema = z.object({
  baseUrl: z.string(),
  syncIntervalMs: z.number(),
  offlineModeEnabled: z.boolean(),
});

export class TypedStorage {
  static async getTasks(): Promise<Task[]> {
    const raw = await AsyncStorage.getItem(KEYS.TASKS);
    if (!raw) return [];
    try {
      const parsed = z.array(taskSchema).safeParse(JSON.parse(raw));
      return parsed.success ? (parsed.data as unknown as Task[]) : [];
    } catch {
      return [];
    }
  }

  static async setTasks(tasks: Task[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.TASKS, JSON.stringify(tasks));
  }

  static async getSettings(): Promise<Settings | null> {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!raw) return null;
    try {
      const parsed = settingsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  static async setSettings(settings: Settings): Promise<void> {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  }

  static async getMutationQueue(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.MUTATION_QUEUE);
  }

  static async setMutationQueue(data: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.MUTATION_QUEUE, data);
  }

  static async getLastSyncTime(): Promise<number | null> {
    const raw = await AsyncStorage.getItem(KEYS.LAST_SYNC);
    if (!raw) return null;
    const time = Number(raw);
    return Number.isNaN(time) ? null : time;
  }

  static async setLastSyncTime(time: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_SYNC, String(time));
  }

  static async clear(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  }
}
