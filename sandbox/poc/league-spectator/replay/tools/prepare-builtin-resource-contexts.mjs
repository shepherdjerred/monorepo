// Exact-build programs only. No registry instance or recorded map state is shipped.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  raw = (path) => Bun.file(path).bytes(),
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  bytes = await raw(`${cache}/research/builtin-resource-contexts-native.json`),
  native = JSON.parse(new TextDecoder().decode(bytes)),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  native.kind !== "original-builtin-resource-context-observations" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.decoderImageSha256 !== sha(image) ||
  native.sharedIdentity !== 3579051965 ||
  native.shared.getterRva !== 0x35a270 ||
  native.shared.resolver !== 0 ||
  !native.shared.readOnly ||
  native.scope.actualReplayRegistry ||
  native.scope.unknownRecordedIdentityAccepted ||
  !native.sourceFingerprintsCheckedBeforeAndAfterExecution
)
  throw Error("Original built-in resource context proof required");
for (const [path, digest] of Object.entries(native.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error(`Changed native context input: ${path}`);
for (const block of native.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Changed original built-in context instructions");
const result = {
  schema: 1,
  kind: "prepared-builtin-resource-context-programs",
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  observationSha256: sha(bytes),
  preparerSha256: sha(await raw(import.meta.path)),
  shared: {
    seedText: "[Shared]",
    identity: native.sharedIdentity,
    multiplier: 65599,
    asciiCase: "lower",
    initializer: native.sharedInitializer,
    registryConstructorRva: native.registryConstructorRva,
    resourceGetterRva: native.shared.getterRva,
    resolver: null,
  },
  registryLookupRva: native.registryLookupRva,
  unknownIdentityPolicy: "unresolved-until-causal-registry-established",
  sourceBlocks: native.originalBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsRegistryInstances: false,
    sharedNullGetterObserved: true,
    actualReplayRegistryRecovered: false,
    globalResourceMapsRecovered: false,
  },
};
const output = `${cache}/public/latest-builtin-resource-contexts/package.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, sha256: sha(await raw(output)) }));
