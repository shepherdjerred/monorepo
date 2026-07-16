/**
 * Task filename generation for created tasks. With `storeTitleInFilename`
 * (upstream default) the filename IS the title, so it must stay readable;
 * collisions get a numeric suffix like Obsidian does ("Title 1.md").
 */

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeTitleForFilename(title: string): string {
  const cleaned = title
    .replaceAll(INVALID_FILENAME_CHARS, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : "Untitled task";
}

/**
 * Pick a vault-relative path for a new task file, deduplicating against
 * `taken` (existing vault-relative paths) with " 1", " 2", ... suffixes.
 */
export function newTaskPath(
  tasksDir: string,
  title: string,
  taken: ReadonlySet<string>,
): string {
  const base = sanitizeTitleForFilename(title);
  const dir = tasksDir === "" ? "" : `${tasksDir}/`;
  for (let attempt = 0; ; attempt += 1) {
    const suffix = attempt === 0 ? "" : ` ${String(attempt)}`;
    const candidate = `${dir}${base}${suffix}.md`;
    if (!taken.has(candidate)) return candidate;
  }
}
