import { useEffect, useState } from "react";
import { z } from "zod";
import type { ProjectPreferences } from "#workspace/workspace.ts";

const PreferenceSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  sound: z.boolean(),
});

export type Preferences = z.infer<typeof PreferenceSchema>;

const appearanceKey = "facet.web.preferences";
const defaults: Preferences = { theme: "system", sound: false };

function readPreferences(): Preferences {
  try {
    const raw = globalThis.localStorage.getItem(appearanceKey);
    if (raw === null) return defaults;
    const decoded = PreferenceSchema.safeParse(JSON.parse(raw));
    return decoded.success ? decoded.data : defaults;
  } catch {
    return defaults;
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    const html = document.documentElement;
    if (preferences.theme === "system") delete html.dataset["theme"];
    else html.dataset["theme"] = preferences.theme;
    try {
      globalThis.localStorage.setItem(
        appearanceKey,
        JSON.stringify(preferences),
      );
    } catch {
      // Settings remain available for the tab when site storage is blocked.
    }
  }, [preferences]);
  return [preferences, setPreferences] as const;
}

const ProjectPreferencesSchema = z.object({
  layout: z.enum(["list", "board"]),
  grouping: z.enum(["section", "priority"]),
  sort: z.enum(["manual", "title", "priority"]),
});

export function loadProjectPreferences(
  key: string,
): ProjectPreferences | undefined {
  try {
    const raw = globalThis.localStorage.getItem(key);
    if (raw === null) return undefined;
    const decoded = ProjectPreferencesSchema.safeParse(JSON.parse(raw));
    return decoded.success ? decoded.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveProjectPreferences(
  key: string,
  options: ProjectPreferences,
): void {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(options));
  } catch {
    // Display preferences can still be used for the current tab.
  }
}

export function useProjectPreferences(
  workspaceKey: string,
  projectId: string | null,
) {
  const [options, setOptions] = useState<Record<string, ProjectPreferences>>(
    {},
  );
  const key = `facet.web.view.${workspaceKey}.${projectId ?? ""}`;
  function save(value: ProjectPreferences): void {
    saveProjectPreferences(key, value);
    setOptions((prior) => ({ ...prior, [key]: value }));
  }
  const preferences =
    projectId === null
      ? undefined
      : (options[key] ?? loadProjectPreferences(key));
  return { preferences, save };
}
