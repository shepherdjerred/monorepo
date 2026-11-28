import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { openLocalWad } from "../wad.mjs";

const [installation, catalogPath, attachmentPath, textureConverter, output] =
  process.argv.slice(2);
assert(
  process.argv.length === 7 && output,
  "Usage: bun prepare-recorded-lee-sin-impact-flash.mjs INSTALLATION EFFECT_CATALOG ATTACHMENT_RECEIPT TEXTURE_CONVERTER NEW_CACHE_DIRECTORY",
);
const directory = resolve(output);
const parent = relative(
  await realpath(".cache"),
  await realpath(dirname(directory)),
);
assert(!isAbsolute(parent) && parent.split(/[\\/]/u)[0] !== "..");

const digest = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
async function readPinned(path, expectedDigest) {
  const bytes = await readFile(path);
  assert.equal(digest(bytes), expectedDigest, `Changed input ${path}`);
  return JSON.parse(bytes);
}
const [catalog, attachment] = await Promise.all([
  readPinned(
    catalogPath,
    "231b9968d5fede04143c7dba9996e143b24c733bd63e0fb0c397efd50aa20a09",
  ),
  readPinned(
    attachmentPath,
    "65e6e2d246c79db5656adec7f7f1fa4373a708e252e306f0b360ec2baf3ce6e2",
  ),
]);
const definitionKey = "leesin-11:4efd5d63";
const definition = catalog.definitions[definitionKey];
const event = attachment.events.find((row) => row.handle === 1073821521);
assert.equal(event.definitionKey, definitionKey);
assert.equal(event.stamp, 1719.2644140625);

const wad = await openLocalWad(
  installation,
  definition.archive,
  Bun.zstdDecompressSync,
  definition.archiveIndexSha256,
);
const authored = await wad(definition.source.path);
assert.equal(digest(authored), definition.source.sha256);
const [rawDefinition] = readExactMapBin(authored).objects.filter(
  (row) => row.pathHash === definition.definition.pathHash,
);
assert.deepEqual(rawDefinition, definition.definition);
const emitter = rawDefinition.fields["868eb76a"].elements[3];
assert.equal(emitter.fields["3d25b8ce"].value, "flash");
const media = definition.media.find(
  (row) => row.reference === emitter.fields["3c6468f4"].value.toLowerCase(),
);
const texture = await wad(media.reference);
assert.equal(digest(texture), media.sha256);

await mkdir(directory);
const raw = join(directory, "flash.tex");
const png = join(directory, "flash.png");
const jobs = join(directory, "jobs.json");
await writeFile(raw, texture, { flag: "wx" });
await writeFile(jobs, JSON.stringify({ [raw]: png }), { flag: "wx" });
const conversion = Bun.spawnSync(["dotnet", resolve(textureConverter), jobs]);
assert.equal(conversion.exitCode, 0, conversion.stderr.toString());
const mip = JSON.parse(conversion.stdout.toString())[raw];
assert.deepEqual(mip, { mipLevel: 0, width: 256, height: 256 });
const receipt = {
  archive: definition.archive,
  archiveIndexSha256: definition.archiveIndexSha256,
  source: definition.source,
  emitter,
  media,
  mip: { ...mip, pngSha256: digest(await readFile(png)) },
  event,
  replaySha256: catalog.replaySha256,
};
await writeFile(join(directory, "authored.json"), JSON.stringify(receipt), {
  flag: "wx",
});
