import path from "node:path";
import { z } from "zod";
import {
  priorityConfigSchema,
  resolveModelConfig,
  statusConfigSchema,
} from "tasknotes-types/v2";
import type {
  PriorityConfig,
  StatusConfig,
  TaskNotesModelConfig,
} from "tasknotes-types/v2";

/**
 * Load the TaskNotes plugin's own settings (`.obsidian/plugins/tasknotes/
 * data.json`, synced into the vault by Obsidian Sync) and resolve them into
 * a `TaskNotesModelConfig`. Using the plugin's live settings — not a copy —
 * is what makes compatibility structural: the same field mapping, workflow
 * statuses, priorities, and task-identification rules drive both sides.
 *
 * A missing file falls back to `resolveModelConfig()` defaults with a loud
 * warning (fresh vaults have no plugin settings yet); a file that EXISTS but
 * fails to parse throws — that's corruption, not absence, and silently
 * reverting to defaults would make the server disagree with the plugin
 * about which files are tasks.
 */

const DATA_JSON_RELATIVE = ".obsidian/plugins/tasknotes/data.json";

const UserMappedFieldSchema = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  key: z.string(),
  type: z.enum(["text", "number", "date", "boolean", "list"]),
});

// Tolerant projection of plugin settings: only the keys the model needs.
// Unknown extra keys are the norm across plugin versions, not an error.
const PluginSettingsSchema = z
  .object({
    taskTag: z.string().optional(),
    taskIdentificationMethod: z.enum(["tag", "property"]).optional(),
    taskPropertyName: z.string().optional(),
    taskPropertyValue: z.string().optional(),
    excludedFolders: z.string().optional(),
    fieldMapping: z.record(z.string(), z.string()).optional(),
    customStatuses: z.array(z.unknown()).optional(),
    customPriorities: z.array(z.unknown()).optional(),
    storeTitleInFilename: z.boolean().optional(),
    userFields: z.array(UserMappedFieldSchema).optional(),
  })
  .loose();

// The v3 schemas' parse output types optionals as `T | undefined`, which
// exactOptionalPropertyTypes rejects against the model's interfaces — these
// builders re-shape the parsed value, omitting absent optionals.
function toStatusConfig(input: unknown): StatusConfig {
  const p = statusConfigSchema.parse(input);
  const out: StatusConfig = {
    id: p.id,
    value: p.value,
    label: p.label,
    color: p.color,
    isCompleted: p.isCompleted,
    order: p.order,
    autoArchive: p.autoArchive,
    autoArchiveDelay: p.autoArchiveDelay,
  };
  if (p.icon !== undefined) out.icon = p.icon;
  if (p.isSkipped !== undefined) out.isSkipped = p.isSkipped;
  if (p.excludeFromCycle !== undefined)
    out.excludeFromCycle = p.excludeFromCycle;
  if (p.nextStatus !== undefined) out.nextStatus = p.nextStatus;
  return out;
}

function toPriorityConfig(input: unknown): PriorityConfig {
  const p = priorityConfigSchema.parse(input);
  const out: PriorityConfig = {
    id: p.id,
    value: p.value,
    label: p.label,
    color: p.color,
    weight: p.weight,
  };
  if (p.icon !== undefined) out.icon = p.icon;
  return out;
}

export type LoadedModelConfig = {
  config: TaskNotesModelConfig;
  /** Where the settings came from — surfaced in /api/health. */
  source: "plugin-data-json" | "defaults";
};

export function dataJsonPath(vaultPath: string): string {
  return path.join(vaultPath, DATA_JSON_RELATIVE);
}

export async function loadModelConfig(
  vaultPath: string,
): Promise<LoadedModelConfig> {
  const file = Bun.file(dataJsonPath(vaultPath));
  if (!(await file.exists())) {
    console.warn(
      `[model-config] ${DATA_JSON_RELATIVE} not found in vault — using ` +
        `default TaskNotes config. Task detection and field mapping may not ` +
        `match the plugin until its settings sync into the vault.`,
    );
    return { config: resolveModelConfig(), source: "defaults" };
  }

  const settings = PluginSettingsSchema.parse(await file.json());
  const defaults = resolveModelConfig();

  const config = resolveModelConfig({
    // The plugin persists a complete mapping; merging over the defaults
    // keeps us total if a future plugin version adds fields.
    fieldMapping: { ...defaults.fieldMapping, ...settings.fieldMapping },
    // The model's own (zod v3) schemas validate config objects — runtime
    // interop across zod majors is fine; only type composition isn't.
    statuses:
      settings.customStatuses === undefined
        ? defaults.statuses
        : settings.customStatuses.map((s) => toStatusConfig(s)),
    priorities:
      settings.customPriorities === undefined
        ? defaults.priorities
        : settings.customPriorities.map((p) => toPriorityConfig(p)),
    storeTitleInFilename:
      settings.storeTitleInFilename ?? defaults.storeTitleInFilename,
    userFields: settings.userFields ?? defaults.userFields,
    taskIdentification: {
      ...defaults.taskIdentification,
      ...(settings.taskIdentificationMethod === undefined
        ? {}
        : { method: settings.taskIdentificationMethod }),
      ...(settings.taskTag === undefined ? {} : { tag: settings.taskTag }),
      ...(settings.taskPropertyName === undefined
        ? {}
        : { propertyName: settings.taskPropertyName }),
      ...(settings.taskPropertyValue === undefined
        ? {}
        : { propertyValue: settings.taskPropertyValue }),
      ...(settings.excludedFolders === undefined
        ? {}
        : { excludedFolders: settings.excludedFolders }),
    },
  });

  return { config, source: "plugin-data-json" };
}
