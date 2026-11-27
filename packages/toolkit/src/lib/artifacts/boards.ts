import path from "node:path";

/** A valid board slug (`[a-z0-9][a-z0-9-]{0,62}`) from free text. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 63)
    .replaceAll(/-+$/gu, "");
  return slug === "" ? "artifact" : slug;
}

/** `yyyy-mm-dd` in local time. */
export function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The board an explicit or implicit target names. Several paths share
 * `<repo-or-dir>-<date>`; a single artifact gets a board named after it.
 */
export function boardSlugFor(options: {
  board: string | undefined;
  pathCount: number;
  firstTitle: string;
  worktree: string;
  now: Date;
}): string {
  if (options.board !== undefined) return options.board;
  return options.pathCount > 1
    ? slugify(`${path.basename(options.worktree)}-${localDate(options.now)}`)
    : slugify(options.firstTitle);
}
