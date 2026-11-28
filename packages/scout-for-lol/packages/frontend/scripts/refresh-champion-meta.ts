import { parseArgs } from "node:util";
import {
  buildChampionMetaSnapshot,
  buildChampionMetaSnapshots,
} from "#src/lib/champion-meta/refresh.ts";
import {
  assertSnapshotWithinBudget,
  serializeSnapshotV2,
} from "#src/lib/champion-meta/snapshot-v2-files.ts";
import {
  changedFileCount,
  refreshSnapshotDirectory,
} from "#src/lib/champion-meta/snapshot-v2-fs.ts";

/**
 * Regenerate the committed champion-meta snapshots from a deployed meta API.
 *
 *   bun run scripts/refresh-champion-meta.ts --origin https://scout-for-lol.com --output <absolute path>
 *   bun run scripts/refresh-champion-meta.ts --origin ... --output <path> --snapshot-dir <absolute .../champion-meta>
 *
 * `--output` is the single-file snapshot `meta/v1` consumers read, formatted
 * with the repository's pinned Prettier so a re-run over unchanged API data is
 * byte-identical. `--snapshot-dir` also writes the split snapshot v2 (an index,
 * one file per champion and one per matchup) in place of that directory, after
 * checking it against its size budget; without it only `--output` is written.
 */
const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    output: { type: "string" },
    "snapshot-dir": { type: "string" },
  },
});
const { origin, output } = values;
const snapshotDir = values["snapshot-dir"];
if (origin === undefined || output === undefined) {
  throw new Error(
    "Usage: --origin <meta API origin> --output <absolute path> [--snapshot-dir <absolute path>]",
  );
}

const { single, split } =
  snapshotDir === undefined
    ? { single: await buildChampionMetaSnapshot({ origin }), split: undefined }
    : await buildChampionMetaSnapshots({ origin });
// The v2 guards run before anything is written, so a refused refresh writes nothing.
if (snapshotDir !== undefined && split !== undefined) {
  const files = serializeSnapshotV2(split);
  assertSnapshotWithinBudget(files);
  const changes = await refreshSnapshotDirectory(snapshotDir, files);
  console.warn(
    `champion-meta snapshot v2: ${split.champions.size.toString()} champions, ${split.matchups.size.toString()} matchups in ${files.size.toString()} files; ${changedFileCount(changes).toString()} changed (${changes.added.length.toString()} added, ${changes.modified.length.toString()} rewritten, ${changes.removed.length.toString()} removed)`,
  );
}

await Bun.write(output, `${JSON.stringify(single, null, 2)}\n`);
const format = Bun.spawn(["bunx", "prettier", "--write", output], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await format.exited) !== 0) {
  throw new Error(`prettier failed to format ${output}`);
}
console.warn(
  `champion-meta snapshot: ${single.champions.length.toString()} champions from ${origin}`,
);
