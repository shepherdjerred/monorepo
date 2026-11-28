import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseChampion, parseMatchup } from "./snapshot-v2-files.ts";
import type { MetaRole } from "@scout-for-lol/data/meta/meta-serving.ts";
import {
  championFile,
  matchupFile,
  SnapshotIndexSchema,
  type SnapshotChampion,
  type SnapshotIndex,
  type SnapshotMatchup,
} from "./snapshot-v2-schema.ts";

/**
 * Read the snapshot v2 at build time, for the static pages. `indexFile` is the
 * `index.json` of a snapshot directory; the champion files sit beside it. Every
 * file is validated against the index it is read through, so a page never
 * renders a champion from another build.
 *
 * Nothing here is reachable from the browser: the pages are generated from
 * these files and no page fetches them.
 */

export type OpenSnapshot = {
  index: SnapshotIndex;
  /** One champion's file, by slug. */
  champion: (slug: string) => Promise<SnapshotChampion>;
  /** Every champion file the index lists, in the index's order. */
  champions: () => Promise<SnapshotChampion[]>;
  /**
   * One matchup file, from `slug`'s side. The champion lists the opponent in
   * that role, or there is no such file and this throws.
   */
  matchup: (
    slug: string,
    role: MetaRole,
    opponentSlug: string,
  ) => Promise<SnapshotMatchup>;
};

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`Champion meta snapshot file ${file} cannot be read`, {
      cause: error,
    });
  }
}

export async function openSnapshot(indexFile: string): Promise<OpenSnapshot> {
  if (!path.isAbsolute(indexFile)) {
    throw new Error(`Snapshot index must be an absolute path: ${indexFile}`);
  }
  const directory = path.dirname(indexFile);
  const raw = await readText(indexFile);
  const index = SnapshotIndexSchema.parse(JSON.parse(raw));
  const cache = new Map<string, Promise<SnapshotChampion>>();

  const load = async (slug: string): Promise<SnapshotChampion> => {
    const listed = index.champions.find((entry) => entry.slug === slug);
    if (listed === undefined) {
      throw new Error(`Snapshot index does not list champion ${slug}`);
    }
    const relative = championFile(slug);
    const text = await readText(path.join(directory, relative));
    return parseChampion(new Map([[relative, text]]), index, listed).champion;
  };

  const champion = (slug: string): Promise<SnapshotChampion> => {
    const cached = cache.get(slug);
    if (cached !== undefined) return cached;
    const loaded = load(slug);
    cache.set(slug, loaded);
    return loaded;
  };

  const matchupCache = new Map<string, Promise<SnapshotMatchup>>();

  const loadMatchup = async (
    slug: string,
    role: MetaRole,
    opponentSlug: string,
  ): Promise<SnapshotMatchup> => {
    const owner = await champion(slug);
    const opponent = owner.matchups
      .find((group) => group.role === role)
      ?.opponents.find((entry) => entry.slug === opponentSlug);
    if (opponent === undefined) {
      throw new Error(
        `Champion ${slug} lists no ${role} matchup against ${opponentSlug}`,
      );
    }
    const relative = matchupFile(slug, role, opponentSlug);
    const text = await readText(path.join(directory, relative));
    return parseMatchup(new Map([[relative, text]]), owner, role, opponent)
      .matchup;
  };

  const matchup = (
    slug: string,
    role: MetaRole,
    opponentSlug: string,
  ): Promise<SnapshotMatchup> => {
    const key = matchupFile(slug, role, opponentSlug);
    const cached = matchupCache.get(key);
    if (cached !== undefined) return cached;
    const loaded = loadMatchup(slug, role, opponentSlug);
    matchupCache.set(key, loaded);
    return loaded;
  };

  return {
    index,
    champion,
    matchup,
    champions: () =>
      Promise.all(index.champions.map((entry) => champion(entry.slug))),
  };
}

const opened = new Map<string, Promise<OpenSnapshot>>();

/** One open snapshot per index file for the life of the build. */
export function openSnapshotOnce(indexFile: string): Promise<OpenSnapshot> {
  const cached = opened.get(indexFile);
  if (cached !== undefined) return cached;
  const loading = openSnapshot(indexFile);
  opened.set(indexFile, loading);
  return loading;
}

export function hasChampions(index: SnapshotIndex): boolean {
  return index.champions.length > 0;
}
