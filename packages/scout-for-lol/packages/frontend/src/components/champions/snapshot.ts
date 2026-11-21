import committed from "#champion-meta-snapshot";
import { parseChampionMetaSnapshot } from "#src/lib/champion-meta/snapshot.ts";

/**
 * The snapshot every champion page and the navigation render from. The
 * `#champion-meta-snapshot` import is the committed snapshot unless
 * `CHAMPION_META_SNAPSHOT_FILE` points the build at another file (see
 * `astro.config.mjs`), which exists so the render path can be exercised with
 * a test fixture without committing data the API never served.
 */
export const championMetaSnapshot = parseChampionMetaSnapshot(committed);
