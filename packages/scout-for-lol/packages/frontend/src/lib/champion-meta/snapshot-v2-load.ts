import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseChampion } from "./snapshot-v2-files.ts";
import {
  championFile,
  SnapshotIndexSchema,
  type SnapshotChampion,
  type SnapshotIndex,
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

  return {
    index,
    champion,
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
