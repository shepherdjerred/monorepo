// Fetch only the original script registry's source-proved virtual filename.
// Retain every archive owner; source existence does not establish precedence.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import {
  openArchivedActorSources,
  actorSha256 as sha,
} from "./archived-actor-sources.mjs";
const [parserArg, sourceArg, cacheArg, evidenceArg] = process.argv.slice(2);
if (!evidenceArg)
  throw Error(
    "Usage: bun inspect-archived-script-registry-input.mjs <pinned-RMAN-parser> <approved-cache> <archive-cache> <original-script-path-evidence.json>",
  );
const { sourceCache, cache, out } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "script-registry-input-", directory: "script-registry-input" },
  ),
  evidenceBytes = await Bun.file(evidenceArg).bytes(),
  evidence = JSON.parse(new TextDecoder().decode(evidenceBytes)),
  requested = "DATA/all_lua_files.manifest";
if (
  evidence.schema !== 1 ||
  evidence.kind !== "original-script-file-manifest-source-reference" ||
  evidence.build !== "16.21.829.8620" ||
  evidence.protocol !== "20e09df23c66b85e" ||
  evidence.decoderImageSha256 !==
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" ||
  evidence.file !== requested ||
  evidence.pathLoadRva !== 0x8528de ||
  evidence.openCallRva !== 0x8528e8 ||
  evidence.openReaderRva !== 0x1479da0 ||
  evidence.scope.sourceOnly !== true
)
  throw Error("Original exact-build script filename evidence required");
const image = await Bun.file(
  path.join(sourceCache, "public/decoder-16.21-macos/image.bin"),
).bytes();
if (
  sha(image) !== evidence.decoderImageSha256 ||
  sha(
    await Bun.file(
      new URL("inspect-original-script-file-manifest.py", import.meta.url),
    ).bytes(),
  ) !== evidence.sourceSha256 ||
  sha(
    image.subarray(
      evidence.literalRva,
      evidence.literalRva + requested.length + 1,
    ),
  ) !== evidence.literalSha256 ||
  new TextDecoder().decode(
    image.subarray(evidence.literalRva, evidence.literalRva + requested.length),
  ) !== requested
)
  throw Error("Original script filename instruction/literal source differs");
for (const block of evidence.sourceBlocks)
  if (
    !Number.isSafeInteger(block.rva) ||
    !Number.isSafeInteger(block.bytes) ||
    block.rva < 0 ||
    block.bytes <= 0 ||
    block.rva + block.bytes > image.length ||
    sha(image.subarray(block.rva, block.rva + block.bytes)) !== block.sha256
  )
    throw Error("Original script registry source block differs");
const source = await openArchivedActorSources({
    parserCheckout: parserArg,
    sourceCache,
    archiveCache: cache,
  }),
  records = [],
  files = [],
  tools = {};
for (const file of [
  "inspect-archived-script-registry-input.mjs",
  "archived-actor-sources.mjs",
  "rman-chunks.mjs",
  "wad.mjs",
  "map-scene-output.mjs",
])
  tools[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
for (const wad of [
  "DATA/FINAL/DATA.wad.client",
  "DATA/FINAL/Global.wad.client",
  "DATA/FINAL/Scripts.wad.client",
  "DATA/FINAL/Bootstrap.windows.wad.client",
]) {
  const archive = await source.wad(wad),
    present = archive.has(requested);
  if (!present) {
    records.push({ wad, namespace: requested, present: false });
    continue;
  }
  const bytes = await source.read(wad, requested),
    file = `source-${records.filter((row) => row.present).length}.bin`;
  await Bun.write(path.join(out, file), bytes);
  files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
  records.push({ wad, namespace: requested, present: true, ...files.at(-1) });
}
for (const [file, digest] of Object.entries(tools))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Original script source extractor changed");
if (sha(await Bun.file(evidenceArg).bytes()) !== sha(evidenceBytes))
  throw Error("Original script path evidence changed");
for (const file of files) {
  const bytes = await Bun.file(path.join(out, file.file)).bytes();
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
    throw Error("Original script input readback differs");
}
const manifest = {
  schema: 1,
  kind: "archived-original-script-registry-input-candidates",
  build: evidence.build,
  protocol: evidence.protocol,
  sourceEvidenceSha256: sha(evidenceBytes),
  requestedNamespace: requested,
  records,
  files,
  tools,
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  scope: {
    allExplicitArchiveOwnersRetained: true,
    archivePrecedenceAdmitted: false,
    originalParserExecuted: false,
    scriptReadinessAdmitted: false,
  },
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    owners: records.filter((row) => row.present),
    explicitArchives: records.length,
    scriptReadinessAdmitted: false,
  }),
);
