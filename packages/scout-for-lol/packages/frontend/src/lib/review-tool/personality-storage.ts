/**
 * Custom personality storage in IndexedDB
 */
import type { Personality } from "./config/schema.ts";
import { PersonalitySchema } from "./config/schema.ts";
import { STORES, getAllItems, putItem, deleteItem } from "./storage.ts";

/**
 * Load custom personalities from IndexedDB
 */
export async function loadCustomPersonalities(): Promise<Personality[]> {
  try {
    const stored = await getAllItems(STORES.PERSONALITIES);
    const ArraySchema = PersonalitySchema.array();
    const result = ArraySchema.safeParse(stored);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

/**
 * Save custom personalities to IndexedDB
 */
export async function saveCustomPersonalities(
  personalities: Personality[],
): Promise<void> {
  // This function is kept for compatibility but not used anymore
  // Individual operations (add/update/delete) are preferred
  for (const personality of personalities) {
    await putItem(STORES.PERSONALITIES, personality);
  }
}

/**
 * Add a custom personality
 */
export async function addCustomPersonality(
  personality: Personality,
): Promise<void> {
  await putItem(STORES.PERSONALITIES, personality);
}

/**
 * Update a custom personality
 */
export async function updateCustomPersonality(
  personality: Personality,
): Promise<boolean> {
  return await putItem(STORES.PERSONALITIES, personality);
}

/**
 * Delete a custom personality
 */
export async function deleteCustomPersonality(id: string): Promise<boolean> {
  return await deleteItem(STORES.PERSONALITIES, id);
}

/**
 * Generate a unique ID for a new personality
 */
export function generatePersonalityId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return `custom-${slug}-${Date.now().toString(36)}`;
}
