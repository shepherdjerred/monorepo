// Offline research tool. The derived decoder stays in a private artifact path.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { prepareExactTerrainDecoder } from "./research/native-terrain-positions-944.mjs";

const usage =
  "Usage: bun prepare-native-terrain-decoder.mjs <pinned-macOS-client> <new-private-output>";

async function main() {
  const [source, output, ...extra] = process.argv.slice(2);
  if (source === "--help" && output === undefined) {
    console.log(usage);
    return;
  }
  if (!source || !output || extra.length > 0) throw Error(usage);
  const decoder = prepareExactTerrainDecoder(await readFile(source));
  await writeFile(output, decoder, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      bytes: decoder.byteLength,
      sha256: createHash("sha256").update(decoder).digest("hex"),
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
