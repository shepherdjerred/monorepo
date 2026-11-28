import path from "node:path";
import { buildSnapshotV2Fixture } from "#src/lib/champion-meta/__fixtures__/snapshot-v2-fixture.ts";
import {
  assertSnapshotWithinBudget,
  serializeSnapshotV2,
} from "#src/lib/champion-meta/snapshot-v2-files.ts";
import { writeSnapshotDirectory } from "#src/lib/champion-meta/snapshot-v2-fs.ts";

/**
 * Rewrite the committed fixture snapshot the design audit renders the public
 * champion pages from. The directory is named `champion-meta` because the
 * writer refuses any other name; its `index.json` is what
 * `CHAMPION_META_SNAPSHOT_FILE` points at.
 *
 *   bun run scripts/write-champion-meta-fixture.ts
 */
const directory = path.resolve(
  import.meta.dirname,
  "../src/lib/champion-meta/__fixtures__/snapshot-v2/champion-meta",
);
const files = serializeSnapshotV2(buildSnapshotV2Fixture());
assertSnapshotWithinBudget(files);
await writeSnapshotDirectory(directory, files);
console.warn(`champion-meta fixture: ${files.size.toString()} files`);
