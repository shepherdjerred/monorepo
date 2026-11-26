import path from "node:path";
import type { ArtifactsClient } from "./client.ts";
import { callOptions } from "./client.ts";
import { ArtifactsCliError } from "./errors.ts";

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

/**
 * Makes sure the board exists before the first upload: `touch` for a board
 * that does, `create` otherwise. A concurrent create is not an error.
 */
export async function ensureBoard(
  client: ArtifactsClient,
  slug: string,
  title: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await client.trpc.boards.touch.mutate({ slug }, callOptions(signal));
    return;
  } catch (error) {
    const failure = client.explain(error);
    if (!(failure instanceof ArtifactsCliError) || failure.kind !== "not-found")
      throw failure;
  }
  try {
    await client.trpc.boards.create.mutate(
      { slug, title },
      callOptions(signal),
    );
  } catch (error) {
    const failure = client.explain(error);
    if (!(failure instanceof ArtifactsCliError) || failure.kind !== "conflict")
      throw failure;
  }
}
