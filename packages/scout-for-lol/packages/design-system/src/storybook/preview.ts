import {
  ScoutModePreferenceSchema,
  ScoutSkinSchema,
  writeScoutThemePreference,
  type ScoutModePreference,
  type ScoutSkin,
} from "#src/runtime/theme.ts";

/**
 * Shared Storybook preview wiring for Scout catalogs.
 *
 * Every Scout catalog offers the same two theme controls and seeds them the
 * same way, so the toolbar definition and the seeding rule live here instead of
 * being copied into each package's `.storybook/preview.tsx`.
 */

export const scoutThemeGlobalTypes = {
  skin: {
    description: "Scout skin",
    toolbar: {
      title: "Skin",
      // Storybook types its toolbar icons as a literal union, so these stay
      // const rather than widening to string.
      icon: "paintbrush" as const,
      items: ["modern", "classic"],
      dynamicTitle: true,
    },
  },
  mode: {
    description: "Appearance",
    toolbar: {
      title: "Mode",
      icon: "mirror" as const,
      items: ["light", "dark", "system"],
      dynamicTitle: true,
    },
  },
};

export type ScoutThemeSelection = {
  skin: ScoutSkin;
  mode: ScoutModePreference;
};

/** Narrows Storybook's untyped globals to a theme, falling back to the default. */
export function resolveScoutThemeGlobals(
  globals: Record<string, unknown>,
): ScoutThemeSelection {
  const parsedSkin = ScoutSkinSchema.safeParse(globals["skin"]);
  const parsedMode = ScoutModePreferenceSchema.safeParse(globals["mode"]);
  return {
    skin: parsedSkin.success ? parsedSkin.data : "modern",
    mode: parsedMode.success ? parsedMode.data : "dark",
  };
}

/**
 * Writes the preference the theme provider boots from.
 *
 * Seeding beats pushing: the provider exposes `setSkin` and `setMode` as
 * separate commits over the same preference object, so calling both in one
 * render applies the second over a stale copy of the first. Callers pair this
 * with a `key` on the provider so a toolbar change re-reads the preference the
 * way a page load would.
 */
export function seedScoutThemePreference(theme: ScoutThemeSelection): void {
  try {
    writeScoutThemePreference(globalThis.localStorage, {
      version: 1,
      skin: theme.skin,
      mode: theme.mode,
    });
  } catch {
    // Storage is an optional boundary; the provider falls back to its default.
  }
}
