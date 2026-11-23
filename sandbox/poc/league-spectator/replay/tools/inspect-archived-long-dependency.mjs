import {
  openArchivedActorSources,
  actorSha256 as sha,
} from "./archived-actor-sources.mjs";

const [parserCheckout, sourceCache, archiveCache, output] =
  process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun inspect-archived-long-dependency.mjs <parser-checkout> <approved-source-cache> <archive-cache> <output.json>",
  );
const source = await openArchivedActorSources({
    parserCheckout,
    sourceCache,
    archiveCache,
  }),
  wad = "DATA/FINAL/Champions/Ahri.wad.client",
  skin = await source.bin(wad, "data/characters/ahri/skins/skin15.bin"),
  file = skin.tree.dependencies.reduce(
    (left, right) => (right.length > left.length ? right : left),
    "",
  );
if (file.length <= 1024)
  throw Error("Actual original long Multi_Skins control is missing");
const bin = await source.bin(wad, file),
  result = {
    schema: 1,
    kind: "original-long-wad-namespace-control",
    file,
    length: file.length,
    sourceSha256: sha(bin.bytes),
    objects: bin.tree.objects.length,
    provenance: source.provenance(),
    rmanReceipts: source.receipts(),
    sourceToolchain: source.toolchain,
    nativeSpectatorAdmitted: false,
  };
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    fileLength: file.length,
    sourceSha256: result.sourceSha256,
    objects: result.objects,
    nativeSpectatorAdmitted: false,
  }),
);
