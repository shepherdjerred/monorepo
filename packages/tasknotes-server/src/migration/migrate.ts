import { z } from "zod";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "tasknotes-types/v2";
import type { TaskNotesModelConfig } from "tasknotes-types/v2";

/**
 * Legacy-vault migration (P4): make files written by the OLD server
 * first-class citizens of the plugin-compatible format.
 *
 * Per file:
 * 1. add the task-identification tag (old files had none — invisible to
 *    both the plugin and the new engine);
 * 2. fold the old `_tasknotes/time-tracking.json` side-store entries into
 *    frontmatter `timeEntries` (keyed by the file's injected `id`);
 * 3. drop the injected `id:` key (path IS the id now).
 *
 * Pure per-file logic — the CLI wraps it with fs walking, dry-run
 * reporting, and idempotency (a migrated file yields `changed: false`).
 */

export const LegacyTimeEntrySchema = z.object({
  taskId: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
});

export type LegacyTimeEntry = z.infer<typeof LegacyTimeEntrySchema>;

export type MigrationResult = {
  changed: boolean;
  content: string;
  actions: string[];
};

const OldServerTaskCoreSchema = z.looseObject({
  title: z.string(),
  status: z.string(),
});

function isOldServerTaskFile(frontmatter: Record<string, unknown>): boolean {
  // Only files the OLD server wrote need migrating, and it always stamped an
  // injected `id` alongside string `title` + `status`. Gating on the `id` key
  // (which this migration then drops in step 3) is the discriminator: a
  // plugin-authored task or an arbitrary note that merely happens to carry
  // `title`/`status` frontmatter has no injected id, so it is left untouched
  // rather than false-tagged. Any id scalar counts — old 8-char ids that look
  // numeric parse as numbers, and the time-fold step coerces both string and
  // numeric ids to the side-store's string key.
  return (
    "id" in frontmatter &&
    OldServerTaskCoreSchema.safeParse(frontmatter).success
  );
}

function frontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const parsed = z.array(z.string()).safeParse(frontmatter["tags"]);
  return parsed.success ? parsed.data : [];
}

export function migrateVaultFile(
  markdown: string,
  config: TaskNotesModelConfig,
  timeEntriesForId: (id: string) => LegacyTimeEntry[],
): MigrationResult {
  const { frontmatter, body } = parseFrontmatter(markdown);
  if (!isOldServerTaskFile(frontmatter)) {
    return { changed: false, content: markdown, actions: [] };
  }

  const actions: string[] = [];
  const next: Record<string, unknown> = { ...frontmatter };

  // (1) task-identification tag
  const tag = config.taskIdentification.tag;
  const tags = frontmatterTags(next);
  if (!tags.includes(tag)) {
    next["tags"] = [...tags, tag];
    actions.push(`add tag "${tag}"`);
  }

  // (2) fold side-store time entries in (dedup on startTime).
  // The old server wrote the same injected id to the frontmatter `id:` AND the
  // side-store `taskId` (always a string). YAML re-parses an all-digit id like
  // `12345678` as a NUMBER, so coerce to string before the lookup — otherwise
  // a numeric-id task's entries are silently skipped and then lost forever when
  // migrate-vault renames time-tracking.json to .migrated.
  const legacyId = z
    .union([z.string(), z.number()])
    .transform(String)
    .safeParse(next["id"]);
  if (legacyId.success) {
    const entries = timeEntriesForId(legacyId.data);
    if (entries.length > 0) {
      const existing = z
        .array(z.looseObject({ startTime: z.string() }))
        .safeParse(next["timeEntries"]);
      const current = existing.success ? existing.data : [];
      const known = new Set(current.map((e) => e.startTime));
      const merged = [
        ...current,
        ...entries
          .filter((e) => !known.has(e.startTime))
          .map(({ taskId: _taskId, ...entry }) => entry),
      ];
      if (merged.length > current.length) {
        next["timeEntries"] = merged;
        actions.push(
          `fold ${String(merged.length - current.length)} time entrie(s) from side-store`,
        );
      }
    }
  }

  // (3) drop the injected id
  if ("id" in next) {
    delete next["id"];
    actions.push("drop injected id key");
  }

  if (actions.length === 0) {
    return { changed: false, content: markdown, actions: [] };
  }
  return {
    changed: true,
    content: serializeMarkdownDocument(next, body),
    actions,
  };
}
