// Static exact-build startup field contract. No replay data or mode value ships.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  bytes = await Bun.file(`${cache}/research/startup-mode-native.json`).bytes(),
  native = JSON.parse(new TextDecoder().decode(bytes)),
  image = await Bun.file(
    `${cache}/public/decoder-16.21-macos/image.bin`,
  ).bytes(),
  profile = await Bun.file(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  ).json();
if (
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== sha(image) ||
  !native.scope.actualRecordedStartupPacket ||
  !native.scope.fullNativeModeSetterGetterExecuted ||
  !native.scope.originalModeRegistrySelectionExecuted ||
  native.scope.fullStartupHandlerExecuted ||
  native.scope.liveUnitResourceStackReconstructed
)
  throw Error(
    "Complete scoped original startup configuration observation required",
  );
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await Bun.file(`${root}/tools/${name}`).bytes()) !== digest)
    throw Error(`Startup producer changed: ${name}`);
for (const [path, digest] of Object.entries(native.inputs))
  if (sha(await Bun.file(path).bytes()) !== digest)
    throw Error("Startup evidence input changed");
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Executed startup instructions changed");
const meta = {
  schema: 1,
  kind: "prepared-original-startup-config",
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: sha(image),
  constructorImageSha256: profile.constructorImageSha256,
  decoderRva: profile.packets[728].entryRva,
  observationSha256: sha(bytes),
  preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
  stream: 3,
  arenaBase: 0x10200000,
  ...native.packetLayout,
  mapIdCodec: native.mapIdCodec,
  mapGetterBlock: [0x61f287, 0x61f2ef],
  modeHash: "casefold-ascii-fnv1a32",
  tftSubsystem: {
    modeKey: 0xb8ffaf71,
    factoryRva: 0x91fec0,
    registrationBlock: [0x9239ba, 0x923a15],
  },
  sourceBlocks: native.sourceBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsConfiguredMode: false,
    originalModeConsumerObserved: true,
    fullStartupHandlerExecuted: false,
    liveResourceStacksRecovered: false,
    effectFactoryExecuted: false,
    mainViewerIntegrated: false,
  },
};
const encoded = JSON.stringify(meta, null, 2);
await Bun.write(`${cache}/public/latest-startup-config/package.json`, encoded);
console.log(JSON.stringify({ sha256: sha(encoded) }));
