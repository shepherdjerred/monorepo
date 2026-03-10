import {
  DEFAULT_LOCAL_STATE,
  DEFAULT_SETTINGS,
  HiddenUsersSchema,
  LLMCacheEntrySchema,
  SettingsSchema,
} from "#src/types/storage.ts";
import type { LLMCacheEntry, LocalState, Settings } from "#src/types/storage.ts";

function parseSettings(raw: unknown): Settings {
  const result = SettingsSchema.safeParse(raw);
  if (result.success) return result.data;
  return DEFAULT_SETTINGS;
}

function parseHiddenUsers(raw: unknown): string[] {
  const result = HiddenUsersSchema.safeParse(raw);
  if (result.success) return result.data;
  return [];
}

function parseLLMCacheEntry(raw: unknown): LLMCacheEntry | undefined {
  const result = LLMCacheEntrySchema.safeParse(raw);
  if (result.success) return result.data;
  return undefined;
}

function parseNumber(raw: unknown, fallback: number): number {
  return typeof raw === "number" ? raw : fallback;
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get("settings");
  return parseSettings(result.settings);
}

export async function setSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.sync.set({ settings: { ...current, ...settings } });
}

export async function getHiddenUsers(): Promise<string[]> {
  const result = await chrome.storage.sync.get("hiddenUsers");
  return parseHiddenUsers(result.hiddenUsers);
}

export async function addHiddenUser(username: string): Promise<void> {
  const users = await getHiddenUsers();
  if (!users.includes(username)) {
    users.push(username);
    await chrome.storage.sync.set({ hiddenUsers: users });
  }
}

export async function removeHiddenUser(username: string): Promise<void> {
  const users = await getHiddenUsers();
  const filtered = users.filter((u) => u !== username);
  await chrome.storage.sync.set({ hiddenUsers: filtered });
}

export async function getLocalState(): Promise<LocalState> {
  const result = await chrome.storage.local.get([
    "replyCount",
    "lastSeenItemId",
    "lastPolledAt",
  ]);
  return {
    replyCount: parseNumber(result.replyCount, DEFAULT_LOCAL_STATE.replyCount),
    lastSeenItemId: parseNumber(result.lastSeenItemId, DEFAULT_LOCAL_STATE.lastSeenItemId),
    lastPolledAt: parseNumber(result.lastPolledAt, DEFAULT_LOCAL_STATE.lastPolledAt),
  };
}

export async function setLocalState(state: Partial<LocalState>): Promise<void> {
  await chrome.storage.local.set(state);
}

const LLM_CACHE_PREFIX = "llm_";

export async function getLLMCacheEntry(hash: string): Promise<LLMCacheEntry | undefined> {
  const key = `${LLM_CACHE_PREFIX}${hash}`;
  const result = await chrome.storage.local.get(key);
  return parseLLMCacheEntry(result[key]);
}

export async function setLLMCacheEntry(hash: string, entry: LLMCacheEntry): Promise<void> {
  const key = `${LLM_CACHE_PREFIX}${hash}`;
  await chrome.storage.local.set({ [key]: entry });
}

export async function pruneOldLLMCache(maxAgeDays = 30): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const keysToRemove: string[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(LLM_CACHE_PREFIX)) {
      const entry = parseLLMCacheEntry(value);
      if (entry && entry.timestamp < cutoff) {
        keysToRemove.push(key);
      }
    }
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && "settings" in changes) {
      callback(parseSettings(changes.settings.newValue));
    }
  });
}

export function onHiddenUsersChanged(callback: (users: string[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && "hiddenUsers" in changes) {
      callback(parseHiddenUsers(changes.hiddenUsers.newValue));
    }
  });
}
