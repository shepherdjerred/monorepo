import path from "node:path";
import {
  championFilePath,
  ChampionMetaFileSchema,
  matchupFilePath,
  MatchupFileSchema,
  MetaManifestSchema,
  META_SERVING_DIR,
  TierFileSchema,
  type ChampionMetaFile,
  type MatchupFile,
  type MetaManifest,
  type TierFile,
} from "@scout-for-lol/data/meta/meta-serving.ts";

/**
 * The one reader of the champion meta serving JSON, shared by the public meta
 * API and the Explore meta tools. Neither reads the lake or the partials.
 *
 * A file that exists but does not parse is a broken internal contract and
 * fails the caller; a file that is not there is `undefined`.
 */
export type MetaReader = {
  manifest: () => Promise<MetaManifest | undefined>;
  /** `relativePath` is a manifest tier entry's `path`. */
  tier: (relativePath: string) => Promise<TierFile | undefined>;
  champion: (championId: number) => Promise<ChampionMetaFile | undefined>;
  matchups: (championId: number) => Promise<MatchupFile | undefined>;
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Reads the serving files of whichever build `resolveBuildDir` names — the
 * published `CURRENT` build in production — one file per call, so a publish
 * between two calls is never read through a half-swapped directory.
 */
export function createLakeMetaReader(
  resolveBuildDir: () => Promise<string | undefined>,
): MetaReader {
  async function read<T>(
    relativePath: string,
    parse: (raw: unknown) => T,
  ): Promise<T | undefined> {
    const buildDir = await resolveBuildDir();
    if (buildDir === undefined) return undefined;
    const file = Bun.file(path.join(buildDir, META_SERVING_DIR, relativePath));
    try {
      return parse(await file.json());
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }
  return {
    manifest: async () =>
      await read("manifest.json", (raw) => MetaManifestSchema.parse(raw)),
    tier: async (relativePath) =>
      await read(relativePath, (raw) => TierFileSchema.parse(raw)),
    champion: async (championId) =>
      await read(championFilePath(championId), (raw) =>
        ChampionMetaFileSchema.parse(raw),
      ),
    matchups: async (championId) =>
      await read(matchupFilePath(championId), (raw) =>
        MatchupFileSchema.parse(raw),
      ),
  };
}
