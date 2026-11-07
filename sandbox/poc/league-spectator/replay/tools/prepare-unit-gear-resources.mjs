// Static authored gear maps only; no replay requests, live units or timestamps.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  bytes = await Bun.file(
    `${cache}/research/unit-gear-resources-native.json`,
  ).bytes(),
  observation = JSON.parse(new TextDecoder().decode(bytes)),
  image = await Bun.file(
    `${cache}/public/decoder-16.21-macos/image.bin`,
  ).bytes();
if (
  observation.build !== "16.21.829.8620" ||
  observation.protocol !== "20e09df23c66b85e" ||
  observation.decoderImageSha256 !== sha(image) ||
  !observation.scope.completeAuthoredGearFieldsRead ||
  !observation.scope.authoredDuplicatePairsPreserved ||
  !observation.scope.originalFirstDuplicateLookupExecuted ||
  observation.scope.liveResourceStackReconstructed ||
  observation.scope.factoryExecuted ||
  observation.scope.postLoadExecuted
)
  throw Error("Complete original authored gear observation required");
for (const [name, digest] of Object.entries(observation.sources))
  if (sha(await Bun.file(`${root}/tools/${name}`).bytes()) !== digest)
    throw Error(`Native gear producer changed: ${name}`);
for (const [path, digest] of Object.entries(observation.inputs))
  if (sha(await Bun.file(path).bytes()) !== digest)
    throw Error("Native gear input changed");
for (const b of observation.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Executed native gear instructions changed");
const meta = {
  schema: 1,
  kind: "prepared-authored-unit-gear-resources",
  build: observation.build,
  protocol: observation.protocol,
  decoderImageSha256: sha(image),
  observationSha256: sha(bytes),
  preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
  duplicatePolicy: "first-native-row-with-key",
  actors: Object.fromEntries(
    observation.tables.map((t) => [
      t.actorKey,
      observation.cases
        .filter((c) => c.actorKey === t.actorKey)
        .map((c) => ({
          index: c.index,
          gearIdentity: c.gearIdentity,
          sourcePath: c.sourcePath,
          sourceSha256: c.sourceSha256,
          resolverPresent: c.loaded.resolver !== null,
          rows: c.loaded.rows,
        })),
    ]),
  ),
  originalBlocks: observation.originalBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsUnitInstances: false,
    originalTypedGearReaderExecuted: true,
    originalSuppliedTableCopyExecuted: true,
    valuesAreUnfixedReferenceTokens: true,
    liveUnitGearSelectionRecovered: false,
    liveResourceStackReconstructed: false,
    effectFactoryExecuted: false,
  },
};
const encoded = JSON.stringify(meta, null, 2);
await Bun.write(
  `${cache}/public/latest-unit-gear-resources/package.json`,
  encoded,
);
console.log(
  JSON.stringify({ sha256: sha(encoded), counts: observation.counts }),
);
