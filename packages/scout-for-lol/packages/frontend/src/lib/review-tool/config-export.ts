/**
 * Export and import all config data for sharing
 */
import { z } from "zod";
import { TabConfigSchema, PersonalitySchema } from "./config/schema.ts";
import type { TabConfig } from "./config/schema.ts";
import {
  CustomArtStyleSchema,
  loadCustomArtStyles,
  saveCustomArtStyles,
} from "./art-style-storage.ts";
import {
  loadCustomPersonalities,
  saveCustomPersonalities,
} from "./personality-storage.ts";
import { getPersonalityById } from "./prompts.ts";

/**
 * Complete exportable config bundle schema (tab-level)
 */
const ConfigBundleSchema = z.object({
  version: z.literal(1), // For future compatibility
  tabConfig: TabConfigSchema,
  customPersonalities: z.array(PersonalitySchema),
  customArtStyles: z.array(CustomArtStyleSchema),
  exportedAt: z.string(),
});

export type ConfigBundle = z.infer<typeof ConfigBundleSchema>;

/**
 * Export all config data as a JSON blob (tab-level)
 * Includes the full personality data if a specific personality is selected
 */
async function exportAllConfig(tabConfig: TabConfig): Promise<ConfigBundle> {
  // Clone the tab config to avoid mutating the original
  const exportedTabConfig = structuredClone(tabConfig);

  // If personalityId is set to a specific built-in personality (not "random"),
  // resolve it and include the full personality data in customPersonality
  if (
    exportedTabConfig.prompts.personalityId !== "random" &&
    !exportedTabConfig.prompts.customPersonality
  ) {
    const personality = getPersonalityById(
      exportedTabConfig.prompts.personalityId,
    );
    if (personality) {
      exportedTabConfig.prompts.customPersonality = personality;
    }
  }

  return {
    version: 1,
    tabConfig: exportedTabConfig,
    customPersonalities: await loadCustomPersonalities(),
    customArtStyles: await loadCustomArtStyles(),
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Export all config as JSON string
 */
async function exportAllConfigAsJSON(tabConfig: TabConfig): Promise<string> {
  return JSON.stringify(await exportAllConfig(tabConfig), null, 2);
}

/**
 * Download config bundle as a JSON file
 */
export async function downloadConfigBundle(
  tabConfig: TabConfig,
): Promise<void> {
  const json = await exportAllConfigAsJSON(tabConfig);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scout-review-config-${new Date().toISOString().split("T")[0] ?? "unknown"}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import config bundle from JSON string
 */
export function importAllConfigFromJSON(json: string): ConfigBundle {
  const parsed = JSON.parse(json);
  return ConfigBundleSchema.parse(parsed);
}

/**
 * Apply imported config bundle to localStorage
 * @param bundle The config bundle to apply
 * @param options Import options
 * @returns The imported TabConfig if importTabConfig was true, undefined otherwise
 */
export async function applyConfigBundle(
  bundle: ConfigBundle,
  options: {
    importTabConfig: boolean;
    importPersonalities: boolean;
    importArtStyles: boolean;
    mergeWithExisting: boolean;
  },
): Promise<TabConfig | undefined> {
  let importedTabConfig: TabConfig | undefined;

  if (options.importTabConfig) {
    importedTabConfig = bundle.tabConfig;
  }

  if (options.importPersonalities) {
    if (options.mergeWithExisting) {
      const existing = await loadCustomPersonalities();
      const existingIds = new Set(existing.map((p) => p.id));
      const newPersonalities = bundle.customPersonalities.filter(
        (p) => !existingIds.has(p.id),
      );
      await saveCustomPersonalities([...existing, ...newPersonalities]);
    } else {
      await saveCustomPersonalities(bundle.customPersonalities);
    }
  }

  if (options.importArtStyles) {
    if (options.mergeWithExisting) {
      const existing = await loadCustomArtStyles();
      const existingIds = new Set(existing.map((s) => s.id));
      const newStyles = bundle.customArtStyles.filter(
        (s) => !existingIds.has(s.id),
      );
      await saveCustomArtStyles([...existing, ...newStyles]);
    } else {
      await saveCustomArtStyles(bundle.customArtStyles);
    }
  }

  return importedTabConfig;
}

/**
 * Get summary of what's in the config bundle
 */
export function getConfigBundleSummary(bundle: ConfigBundle): {
  hasTabConfig: boolean;
  personalitiesCount: number;
  artStylesCount: number;
  exportedAt: string;
} {
  return {
    hasTabConfig: Boolean(bundle.tabConfig),
    personalitiesCount: bundle.customPersonalities.length,
    artStylesCount: bundle.customArtStyles.length,
    exportedAt: bundle.exportedAt,
  };
}
