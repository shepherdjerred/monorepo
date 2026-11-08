// Static, exact-build preparation from an installed client. No match decoding.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay } from "../transport.mjs";
import { inspectExecutable } from "./pe.mjs";
import { openLocalWad } from "./wad.mjs";

const [installation, replayPath, vendorPath, output] = process.argv.slice(2);
if (!installation || !replayPath || !vendorPath || !output)
  throw Error(
    "Usage: bun tools/prepare-local-assets.mjs <League-installation> <replay.rofl> <fzstd.mjs> <output-root>",
  );
const executable = await readFile(
  resolve(installation, "Game/League of Legends.exe"),
);
const pe = inspectExecutable(executable);
const bytes = await readFile(replayPath);
const replay = openReplay(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
if (replay.build !== pe.version)
  throw Error(
    `Executable/replay build mismatch: ${pe.version} / ${replay.build}`,
  );
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const executableHash = sha256(executable);
const root = resolve(output, `${pe.version}-${executableHash.slice(0, 12)}`);
const installRoot = resolve(installation);
if (
  root === installRoot ||
  root.startsWith(installRoot + "/") ||
  root.startsWith(installRoot + "\\")
)
  throw Error("Prepared output must be outside the League installation");
const { decompress } = await import(pathToFileURL(resolve(vendorPath)).href);
const definitions = [];
for (const champion of new Set(replay.roster.map((p) => p.champion))) {
  if (!/^[A-Za-z0-9_]+$/.test(champion))
    throw Error("Invalid champion asset identifier");
  const key = champion.toLowerCase();
  const wad = `DATA/FINAL/Champions/${champion}.wad.client`;
  const get = await openLocalWad(installation, wad, decompress);
  const asset = `data/characters/${key}/${key}.bin`;
  const data = await get(asset);
  if (Buffer.from(data.subarray(0, 4)).toString("ascii") !== "PROP")
    throw Error(`Invalid character definition ${asset}`);
  const file = `characters/${key}.bin`;
  await Bun.write(resolve(root, file), data);
  definitions.push({
    champion,
    wad,
    asset,
    file,
    bytes: data.length,
    sha256: sha256(data),
  });
}
const installedManifest = (
  await readFile(resolve(installation, "Game.ok"), "utf8")
)
  .trim()
  .split(/\r?\n/)[0];
const manifest = {
  schema: 1,
  build: pe.version,
  executableSha256: executableHash,
  installedManifest,
  definitions,
  scope: "character-root-definitions-only",
  equippedSkinsDecoded: false,
  dependencyClosureComplete: false,
  gameplayDecoderAvailable: false,
};
await Bun.write(
  resolve(root, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify(
    {
      output: root,
      characters: definitions.length,
      bytes: definitions.reduce((total, d) => total + d.bytes, 0),
      scope: manifest.scope,
    },
    null,
    2,
  ),
);
