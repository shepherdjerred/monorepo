/**
 * Configuration persistence and import/export
 */
import { z } from "zod";
import type { ReviewConfig, GlobalConfig } from "./config/schema.ts";
import {
  GlobalConfigSchema,
  ApiSettingsSchema,
  TextGenerationSettingsSchema,
  ImageGenerationSettingsSchema,
  PromptSettingsSchema,
} from "./config/schema.ts";
import { STORES, getItem, setItem } from "./storage.ts";

// Construct ReviewConfig schema from component schemas for backward compatibility
const ReviewConfigSchema = z.object({
  api: ApiSettingsSchema,
  textGeneration: TextGenerationSettingsSchema,
  imageGeneration: ImageGenerationSettingsSchema,
  prompts: PromptSettingsSchema,
});

/**
 * Load current active configuration
 */
export async function loadCurrentConfig(): Promise<ReviewConfig | null> {
  try {
    const stored = await getItem(STORES.CURRENT_CONFIG, "current");
    if (!stored) {
      return null;
    }
    const result = ReviewConfigSchema.safeParse(stored);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Save current active configuration
 */
export async function saveCurrentConfig(config: ReviewConfig): Promise<void> {
  await setItem(STORES.CURRENT_CONFIG, "current", config);
}

/**
 * Load global configuration (API keys shared across tabs)
 */
export async function loadGlobalConfig(): Promise<GlobalConfig | null> {
  try {
    const stored = await getItem(STORES.GLOBAL_CONFIG, "global");
    if (!stored) {
      return null;
    }
    return GlobalConfigSchema.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Save global configuration (API keys shared across tabs)
 */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await setItem(STORES.GLOBAL_CONFIG, "global", config);
}

/**
 * Export global config as base64-encoded string (for sharing API keys)
 */
export function exportGlobalConfigAsBlob(config: GlobalConfig): string {
  const json = JSON.stringify(config);
  return btoa(json);
}

/**
 * Import global config from base64-encoded string
 */
export function importGlobalConfigFromBlob(blob: string): GlobalConfig {
  try {
    const json = atob(blob);
    const parsed = JSON.parse(json);
    return GlobalConfigSchema.parse(parsed);
  } catch {
    throw new Error(
      "Invalid config blob. Please check the format and try again.",
    );
  }
}
