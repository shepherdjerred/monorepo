/**
 * Image generation prompt template for AI-generated review images
 *
 * This module provides a simple wrapper for generating images from pre-crafted descriptions.
 * The image description is generated in a previous step (Step 3) from the review text.
 */

import type { ArtStyle } from "@scout-for-lol/data/review/art-categories";
import IMAGE_GENERATION_PROMPT_TEMPLATE from "./prompts/user/4-image-generation.txt";

/**
 * Generate the image generation prompt for Gemini
 *
 * @param imageDescription - The pre-crafted image description from Step 3
 * @param artStyle - The art style to apply to the generated image
 * @returns The prompt to send to Gemini for image generation
 */
export function generateImagePrompt(imageDescription: string, artStyle: ArtStyle): string {
  return IMAGE_GENERATION_PROMPT_TEMPLATE.replaceAll("<IMAGE_DESCRIPTION>", imageDescription).replaceAll(
    "<ART_STYLE>",
    artStyle.description,
  );
}
