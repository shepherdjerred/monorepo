/**
 * Custom art style storage in IndexedDB
 */
import { z } from "zod";
import { STORES, getAllItems, putItem } from "./storage.ts";

/**
 * Custom art style schema
 */
export const CustomArtStyleSchema = z.object({
  id: z.string(),
  description: z.string(), // The style description (same as name)
});

export type CustomArtStyle = z.infer<typeof CustomArtStyleSchema>;

/**
 * Load custom art styles from IndexedDB
 */
export async function loadCustomArtStyles(): Promise<CustomArtStyle[]> {
  try {
    const stored = await getAllItems(STORES.ART_STYLES);
    const ArraySchema = CustomArtStyleSchema.array();
    const result = ArraySchema.safeParse(stored);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

/**
 * Save custom art styles to IndexedDB
 */
export async function saveCustomArtStyles(styles: CustomArtStyle[]): Promise<void> {
  for (const style of styles) {
    await putItem(STORES.ART_STYLES, style);
  }
}
