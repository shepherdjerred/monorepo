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
