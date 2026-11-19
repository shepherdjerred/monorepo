import { createLakeMetaReader } from "#src/meta/meta-reader.ts";
import { readCurrentBuildDir, resolveLakeDir } from "#src/report-lake/paths.ts";

/**
 * The champion meta of the published lake build: the serving JSON under
 * `CURRENT`, resolved on every read so a publish is picked up without a
 * restart. The meta API and the Explore meta tools share this one reader.
 */
export const publishedMetaReader = createLakeMetaReader(
  async () => await readCurrentBuildDir(resolveLakeDir()),
);
