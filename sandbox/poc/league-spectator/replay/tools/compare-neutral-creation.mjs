import { resolve } from "node:path";
import { createLatestNeutralCreationReader } from "../latest-neutral-creation.mjs";
const [assetsArg, packageArg, captureArg, argumentsArg, outputArg] =
  process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun compare-neutral-creation.mjs <approved-public-assets> <field-package.json> <original-capture.json> <native-arguments.json> <output.json>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
async function raw(file) {
  const key = resolve(file),
    bytes = await Bun.file(key).bytes();
  inputs[key] = sha(bytes);
  return bytes;
}
const json = async (file) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(file)));
const profile = await json(
  resolve(assetsArg, "decoder-16.21-macos/profile.json"),
);
const reader = await createLatestNeutralCreationReader({
  profile,
  image: await raw(resolve(assetsArg, "decoder-16.21-macos/image.bin")),
  packageBytes: await raw(packageArg),
});
const capture = await json(captureArg),
  native = await json(argumentsArg);
if (
  native.captureSha256 !== inputs[resolve(captureArg)] ||
  native.boundary !== null ||
  capture.records.length !== native.records.length
)
  throw Error("Matching complete original neutral observations required");
let compared = 0;
for (const [index, row] of capture.records.entries()) {
  const actual = reader.read({
      complete: true,
      object: new Uint8Array(Buffer.from(row.objectHex, "hex")),
      heap: new Uint8Array(Buffer.from(row.heapHex, "hex")),
    }),
    expected = native.records[index];
  for (const [key, value] of Object.entries({
    entityId: expected.previousLookupIdArgument,
    character: expected.character,
    requestedSkinId: expected.skinId,
    nativeTeamEnum: expected.teamArgument,
    firstVectorArgument: expected.firstVectorArgument,
    secondVectorArgument: expected.secondVectorArgument,
    scalarArgumentBits: expected.scalarArgumentBits,
    name: expected.name,
    secondaryName: expected.secondaryName,
  }))
    if (JSON.stringify(actual[key]) !== JSON.stringify(value))
      throw Error(
        `Original neutral factory argument differs at ${index}:${key}`,
      );
  compared++;
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Neutral comparison input changed: " + file);
const result = {
  schema: 1,
  kind: "original-neutral-codec-comparison",
  build: capture.build,
  protocol: capture.protocol,
  compared,
  inputs,
  readerSha256: sha(
    await Bun.file(
      new URL("../latest-neutral-creation.mjs", import.meta.url),
    ).bytes(),
  ),
  comparerSha256: sha(await Bun.file(import.meta.path).bytes()),
  scope: {
    allCapturedFactoryArgumentsEqual: true,
    finalResourceSkinResolutionIncluded: false,
    nativeFactoryAcceptance: false,
    nativeSpectatorEquivalent: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: resolve(outputArg), compared }));
