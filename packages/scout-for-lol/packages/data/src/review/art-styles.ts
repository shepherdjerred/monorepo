/**
 * Art styles selection logic for AI-generated review images
 *
 * Styles = Visual aesthetics (how it looks)
 * Matching via categories creates natural combinations
 */

import type { ArtStyle } from "./art-categories.ts";
import { ART_STYLES } from "./art-styles-list.ts";

/**
 * Selection result
 */
export type StyleSelection = {
  style: string;
};

/**
 * Select a random style from the styles array
 */
export function selectRandomStyle(): ArtStyle {
  const randomIndex = Math.floor(Math.random() * ART_STYLES.length);
  const style = ART_STYLES[randomIndex];
  if (!style) {
    throw new Error("Failed to select art style");
  }
  return style;
}
