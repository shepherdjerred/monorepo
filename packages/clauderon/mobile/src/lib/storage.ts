import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  DAEMON_URL: "@clauderon/daemon_url",
  THEME: "@clauderon/theme",
} as const;

/**
 * Generic storage helper with typed get/set methods
 */
export const storage = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await AsyncStorage.getItem(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      console.error(`Failed to get ${key}:`, error);
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to set ${key}:`, error);
      throw error;
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove ${key}:`, error);
      throw error;
    }
  },
};

/**
 * Get the daemon URL from storage
 */
export async function getDaemonUrl(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.DAEMON_URL);
  } catch (error) {
    console.error("Failed to get daemon URL:", error);
    return null;
  }
}

/**
 * Set the daemon URL in storage
 */
export async function setDaemonUrl(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.DAEMON_URL, url);
  } catch (error) {
    console.error("Failed to set daemon URL:", error);
    throw error;
  }
}

/**
 * Remove the daemon URL from storage
 */
export async function removeDaemonUrl(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.DAEMON_URL);
  } catch (error) {
    console.error("Failed to remove daemon URL:", error);
    throw error;
  }
}
