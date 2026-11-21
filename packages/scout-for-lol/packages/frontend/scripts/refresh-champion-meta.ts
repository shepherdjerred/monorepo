import { parseArgs } from "node:util";
import { buildChampionMetaSnapshot } from "#src/lib/champion-meta/refresh.ts";

/**
 * Regenerate the committed champion-meta snapshot from a deployed meta API.
 *
 *   bun run scripts/refresh-champion-meta.ts --origin https://scout-for-lol.com --output <absolute path>
 *
 * The output is formatted with the repository's pinned Prettier so a re-run
 * over unchanged API data is byte-identical.
 */
const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    output: { type: "string" },
  },
});
const { origin, output } = values;
if (origin === undefined || output === undefined) {
  throw new Error("Usage: --origin <meta API origin> --output <absolute path>");
}

const snapshot = await buildChampionMetaSnapshot({ origin });
await Bun.write(output, `${JSON.stringify(snapshot, null, 2)}\n`);
const format = Bun.spawn(["bunx", "prettier", "--write", output], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await format.exited) !== 0) {
  throw new Error(`prettier failed to format ${output}`);
}
console.warn(
  `champion-meta snapshot: ${snapshot.champions.length.toString()} champions from ${origin}`,
);
