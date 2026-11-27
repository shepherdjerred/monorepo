// Offline research tool. The derived decoder stays in a private artifact path.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { openReplay } from "../transport.mjs";
import { prepareExactTerrainDecoder } from "./research/native-terrain-positions-944.mjs";

const usage =
  "Usage: bun prepare-native-terrain-decoder.mjs <pinned-macOS-client> <new-private-output> [--for-replay <saved-rofl>]";

async function main() {
  const { positionals, values } = parseArgs({
    options: { help: { type: "boolean" }, "for-replay": { type: "string" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const [source, output] = positionals;
  if (!source || !output || positionals.length !== 2) throw Error(usage);
  const replayPath = values["for-replay"];
  const client = await readFile(source);
  const replay =
    replayPath === undefined
      ? undefined
      : openReplay(await Bun.file(replayPath).arrayBuffer());
  const decoder = prepareExactTerrainDecoder(client, replay, {
    allowCurrentBuild: replay !== undefined,
  });
  await writeFile(output, decoder, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      bytes: decoder.byteLength,
      sha256: createHash("sha256").update(decoder).digest("hex"),
      ...(replay === undefined
        ? {}
        : { build: replay.build, protocol: replay.protocol }),
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
