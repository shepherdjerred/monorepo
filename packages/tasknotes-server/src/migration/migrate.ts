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
 * 2. drop the injected `id:` key (path IS the id now).
 *
 * Pure per-file logic — the CLI wraps it with fs walking, dry-run
 * reporting, and idempotency (a migrated file yields `changed: false`).
 */

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
  // (which this migration then drops in step 2) is the discriminator: a
  // plugin-authored task or an arbitrary note that merely happens to carry
  // `title`/`status` frontmatter has no injected id, so it is left untouched
  // rather than false-tagged. Any id scalar counts — old 8-char ids that look
  // numeric parse as numbers; either scalar identifies a legacy note.
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

  // (2) drop the injected id
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
