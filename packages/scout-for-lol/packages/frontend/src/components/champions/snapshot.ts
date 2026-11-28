import { openSnapshotOnce } from "#src/lib/champion-meta/snapshot-v2-load.ts";

/**
 * The snapshot every champion page and the navigation render from: the split
 * snapshot v2 (`src/data/generated/champion-meta/index.json`) unless
 * `CHAMPION_META_SNAPSHOT_FILE` points the build at another snapshot's
 * `index.json`, which exists so the render path can be exercised with a test
 * fixture without committing data the API never served. `astro.config.mjs`
 * defines `CHAMPION_META_INDEX_FILE` as that absolute path.
 */
declare const CHAMPION_META_INDEX_FILE: string;

export const championMetaSnapshot = openSnapshotOnce(CHAMPION_META_INDEX_FILE);
