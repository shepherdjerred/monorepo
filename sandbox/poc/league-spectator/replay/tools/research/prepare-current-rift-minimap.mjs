import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { openLocalWad } from "../wad.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mapDefinition = "data/maps/shipping/map11/map11.bin";
const mapDefinitionSha256 =
  "bf4b0fdfe1070103cad2d5f1e36a637f7c0d11a565f841acdbe3738fac6fe69d";
const defaultSkin = "Maps/Shipping/Map11/MapSkins/Default";
const defaultBackground =
  "assets/maps/info/map11/2dlevelminimap_base_baron1.tex";
const defaultTextureSha256 =
  "35528b693d790d95a4ef3ad68feb9f67800b7c32a09183b1e33376aa0e4b272b";
const defaultPngSha256 =
  "af8cdfa5d1f12a5c68950f607c514db36d8eef6e053c0af70adb56cdf2d2a26c";

export async function readCurrentRiftMinimap(path) {
  const png = await readFile(path);
  assert.equal(
    sha256(png),
    defaultPngSha256,
    "Expected the reviewed Default Rift minimap",
  );
  return png;
}

if (import.meta.main) {
  const [installation, exporter, output, ...extra] = Bun.argv.slice(2);
  assert.ok(
    output && extra.length === 0,
    "Usage: bun prepare-current-rift-minimap.mjs <installation> <TerrainTextureMips.dll> <new private minimap PNG>",
  );
  const destination = resolve(output);
  const cache = await realpath(".cache");
  const parent = await realpath(dirname(destination));
  assert.ok(parent === cache || parent.startsWith(cache + sep));
  const wad = await openLocalWad(
    installation,
    "DATA/FINAL/Maps/Shipping/Map11.wad.client",
    Bun.zstdDecompressSync,
  );
  const map = readExactMapBin(await wad(mapDefinition));
  assert.equal(map.sourceSha256, mapDefinitionSha256);
  const skin = map.objects.find(
    ({ pathHash }) => pathHash === mapBinHash(defaultSkin),
  );
  assert.equal(skin?.classHash, mapBinHash("MapSkin"));
  const config = skin.fields[mapBinHash("mMinimapBackgroundConfig")];
  assert.equal(config.classHash, mapBinHash("MinimapBackgroundConfig"));
  const background = config.fields[mapBinHash("mDefaultTextureName")];
  assert.equal(background.type, "WadChunkLink");
  assert.equal(BigInt(background.value).toString(16), "9eaab3ae5728854c");
  const tex = await wad(defaultBackground);
  assert.equal(sha256(tex), defaultTextureSha256);

  const work = await mkdtemp(join(parent, "rift-minimap-export-"));
  const input = join(work, "minimap.tex");
  const decoded = join(work, "minimap.png");
  const jobs = join(work, "jobs.json");
  await writeFile(input, tex);
  await writeFile(jobs, JSON.stringify({ [input]: decoded }));
  const child = Bun.spawn(["dotnet", resolve(exporter), jobs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(status, 0, `Rift minimap export failed: ${stderr.trim()}`);
  assert.deepEqual(JSON.parse(stdout)[input], {
    mipLevel: 0,
    width: 512,
    height: 512,
  });
  const png = await readCurrentRiftMinimap(decoded);
  await writeFile(destination, png, { flag: "wx" });
  console.log(defaultPngSha256);
}
