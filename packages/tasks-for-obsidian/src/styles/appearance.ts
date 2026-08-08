import { z } from "zod";

export const AppearancePreferenceSchema = z.enum(["system", "light", "dark"]);

export type AppearancePreference = z.infer<typeof AppearancePreferenceSchema>;

const StoredAppearanceSchema = z
  .object({
    version: z.literal(1),
    appearance: AppearancePreferenceSchema,
  })
  .strict();

const LegacyDarkModeSchema = z.enum(["true", "false"]);

export type SystemAppearance = "light" | "dark" | "unspecified";

export type AppearanceLoadResult = {
  appearance: AppearancePreference;
  needsMigration: boolean;
};

export function loadAppearancePreference(
  stored: string | null,
  legacyDarkMode: string | null,
): AppearanceLoadResult {
  if (stored !== null) {
    const value: unknown = JSON.parse(stored);
    const parsed = StoredAppearanceSchema.parse(value);
    return { appearance: parsed.appearance, needsMigration: false };
  }

  if (legacyDarkMode !== null) {
    const legacy = LegacyDarkModeSchema.parse(legacyDarkMode);
    return {
      appearance: legacy === "true" ? "dark" : "light",
      needsMigration: true,
    };
  }

  return { appearance: "system", needsMigration: true };
}

export function serializeAppearancePreference(
  appearance: AppearancePreference,
): string {
  return JSON.stringify({ version: 1, appearance });
}

export function appearanceOverride(
  appearance: AppearancePreference,
): SystemAppearance {
  return appearance === "system" ? "unspecified" : appearance;
}

export function resolveAppearance(
  appearance: AppearancePreference,
  systemAppearance: SystemAppearance,
): "light" | "dark" {
  if (appearance !== "system") return appearance;
  return systemAppearance === "dark" ? "dark" : "light";
}
