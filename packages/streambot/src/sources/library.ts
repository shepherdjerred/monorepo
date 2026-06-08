import path from "node:path";
import { sep as posixSep } from "node:path/posix";
import { normalizeTitle } from "@shepherdjerred/streambot/sources/normalize.ts";

/** A playable video file discovered under a library root. */
export type LibraryEntry = {
  /** Normalized, human-friendly title (release junk stripped) — shown and matched against. */
  readonly title: string;
  /** Absolute path passed to ffmpeg. */
  readonly path: string;
  /** Path relative to its root (for disambiguation / display). */
  readonly relativePath: string;
  /** The root this entry came from (e.g. "videos", "movies", "tv"). */
  readonly library: string;
};

/** A scannable library root: a directory and a short label. */
export type LibraryRoot = {
  readonly dir: string;
  readonly label: string;
};

function normalizeExtensions(extensions: readonly string[]): Set<string> {
  return new Set(
    extensions.map((extension) => extension.replace(/^\./u, "").toLowerCase()),
  );
}

/**
 * Recursively scan one library root for playable video files. Upstream StreamBot only listed the
 * top level; a real Plex/Jellyfin library is deeply nested, so we walk the whole tree.
 */
export async function scanRoot(
  root: LibraryRoot,
  extensions: readonly string[],
): Promise<LibraryEntry[]> {
  const allowed = normalizeExtensions(extensions);
  const glob = new Bun.Glob("**/*");
  const entries: LibraryEntry[] = [];

  for await (const relative of glob.scan({
    cwd: root.dir,
    onlyFiles: true,
    followSymlinks: true,
  })) {
    const extension = path.extname(relative).replace(/^\./u, "").toLowerCase();
    if (!allowed.has(extension)) {
      continue;
    }
    entries.push({
      title: normalizeTitle(path.basename(relative, path.extname(relative))),
      path: path.join(root.dir, relative),
      relativePath: relative.split(path.sep).join(posixSep),
      library: root.label,
    });
  }

  return entries;
}

/** Scan every root, tolerating individual roots that fail (e.g. an unmounted media dir). */
export async function scanLibrary(
  roots: readonly LibraryRoot[],
  extensions: readonly string[],
): Promise<LibraryEntry[]> {
  const perRoot = await Promise.all(
    roots.map(async (root) => {
      try {
        return await scanRoot(root, extensions);
      } catch {
        return [];
      }
    }),
  );
  return perRoot.flat();
}

function score(title: string, query: string): number {
  const haystack = title.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack === needle) {
    return 3;
  }
  if (haystack.startsWith(needle)) {
    return 2;
  }
  if (haystack.includes(needle)) {
    return 1;
  }
  return 0;
}

/**
 * Rank library entries against a query (exact > prefix > substring, case-insensitive). Pure and
 * deterministic — the search behaviour is fully unit-testable without touching the filesystem.
 */
export function searchLibrary(
  entries: readonly LibraryEntry[],
  query: string,
  limit = 25,
): LibraryEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  return entries
    .map((entry) => ({ entry, score: score(entry.title, trimmed) }))
    .filter((scored) => scored.score > 0)
    .toSorted(
      (a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title),
    )
    .slice(0, limit)
    .map((scored) => scored.entry);
}

/** Find the single best library match for a query, or null. */
export function findBestMatch(
  entries: readonly LibraryEntry[],
  query: string,
): LibraryEntry | null {
  return searchLibrary(entries, query, 1)[0] ?? null;
}
