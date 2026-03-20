/**
 * Reset tool settings to defaults while preserving API keys, cache, and cost data
 */
import { clearAllEntries } from "./indexeddb.ts";
import { STORES, clearStore } from "./storage.ts";

/**
 * Reset all settings to defaults while preserving:
 * - API keys (in global config)
 * - Cloudflare cache
 * - Cost data
 *
 * Clears:
 * - Saved configurations
 * - Current config
 * - Generation history (IndexedDB)
 * - Custom personalities
 * - Custom art styles
 */
export async function resetToDefaults(): Promise<void> {
  try {
    // Clear IndexedDB stores (except global config, costs, and preferences)
    await clearStore(STORES.CONFIGS);
    await clearStore(STORES.CURRENT_CONFIG);
    await clearStore(STORES.PERSONALITIES);
    await clearStore(STORES.ART_STYLES);

    // Clear IndexedDB history
    await clearAllEntries();
  } catch (error) {
    console.error("Error resetting to defaults:", error);
    throw error;
  }
}

/**
 * Check which items would be cleared by reset
 * @returns Object with counts of items that would be cleared
 */
export async function getResetPreview(): Promise<{
  configs: number;
  historyEntries: number;
  customPersonalities: number;
  customArtStyles: number;
}> {
  try {
    // Get IndexedDB history count
    const { getEntryCount } = await import("./indexeddb");
    const historyEntries = await getEntryCount().catch(() => 0);

    // Get counts from IndexedDB stores
    const { getAllItems } = await import("./storage");
    const configs = await getAllItems(STORES.CONFIGS);
    const personalities = await getAllItems(STORES.PERSONALITIES);
    const artStyles = await getAllItems(STORES.ART_STYLES);

    return {
      configs: configs.length,
      historyEntries,
      customPersonalities: personalities.length,
      customArtStyles: artStyles.length,
    };
  } catch {
    // Return zeros if not in browser environment
    return {
      configs: 0,
      historyEntries: 0,
      customPersonalities: 0,
      customArtStyles: 0,
    };
  }
}
