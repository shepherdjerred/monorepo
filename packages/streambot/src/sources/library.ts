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
  readonly year?: number;
  readonly series?: string;
  readonly season?: number;
  readonly episode?: number;
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
 * top level; a real Plex library is deeply nested, so we walk the whole tree.
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
    const title = normalizeTitle(
      path.basename(relative, path.extname(relative)),
    );
    const episode = /\bS(?<season>\d{1,2})E(?<episode>\d{1,3})\b/iu.exec(title);
    const year = /(?:^|\D)(?<year>(?:19|20)\d{2})(?:\D|$)/u.exec(title);
    const relativeParts = relative.split(path.sep);
    entries.push({
      title,
      path: path.join(root.dir, relative),
      relativePath: relative.split(path.sep).join(posixSep),
      library: root.label,
      ...(year?.groups?.["year"] === undefined
        ? {}
        : { year: Number(year.groups["year"]) }),
      ...(episode?.groups?.["season"] === undefined ||
      episode.groups["episode"] === undefined
        ? {}
        : {
            series: relativeParts[0] ?? title,
            season: Number(episode.groups["season"]),
            episode: Number(episode.groups["episode"]),
          }),
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

function searchable(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

function bigrams(value: string): Set<string> {
  const padded = ` ${value} `;
  const result = new Set<string>();
  for (let index = 0; index < padded.length - 1; index += 1) {
    result.add(padded.slice(index, index + 2));
  }
  return result;
}

/** Fuzzy title relevance shared with federated discovery. */
export function scoreLibraryTitle(title: string, query: string): number {
  const haystack = searchable(title);
  const needle = searchable(query);
  if (needle.length === 0) return 0;
  if (haystack === needle) {
    return 100;
  }
  if (haystack.startsWith(needle)) {
    return 92;
  }
  if (haystack.includes(needle)) {
    return 82;
  }
  const queryTokens = new Set(needle.split(" "));
  const titleTokens = new Set(haystack.split(" "));
  const sharedTokens = [...queryTokens].filter((token) =>
    titleTokens.has(token),
  );
  const tokenScore = (sharedTokens.length / queryTokens.size) * 75;
  const queryBigrams = bigrams(needle);
  const titleBigrams = bigrams(haystack);
  const sharedBigrams = [...queryBigrams].filter((item) =>
    titleBigrams.has(item),
  );
  const dice =
    (2 * sharedBigrams.length) / (queryBigrams.size + titleBigrams.size);
  return Math.round(Math.max(tokenScore, dice * 70));
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
    .map((entry) => ({ entry, score: scoreLibraryTitle(entry.title, trimmed) }))
    .filter((scored) => scored.score >= 45)
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
