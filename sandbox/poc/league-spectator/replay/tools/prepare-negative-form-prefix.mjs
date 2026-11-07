// Static original program/capability only; replay observations stay in report.
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Changed input: ${path}`);
  inputs[path] = digest;
  return bytes;
}
async function read(path) {
  return JSON.parse(new TextDecoder().decode(await raw(path)));
}
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  assets = await read(`${cache}/public/latest-effects/package.json`);
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  (await sha256(image)) !== profile.decoderImageSha256
)
  throw Error("Exact original negative-form build required");
const names = [
    "negative-form-listener-native",
    "negative-form-lazy-hero-prefix-native",
    "negative-form-lazy-hero-no-render-native",
  ],
  proofs = [],
  blocks = new Map();
for (const name of names) {
  const path = `${cache}/research/${name}.json`,
    proof = await read(path);
  if (
    proof.build !== profile.clientVersion ||
    proof.protocol !== profile.protocolDigest ||
    proof.decoderImageSha256 !== profile.decoderImageSha256
  )
    throw Error("Exact original negative-form proof required");
  for (const [path, digest] of Object.entries({
    ...proof.inputs,
    ...proof.sources,
  }))
    if ((await sha256(await raw(path))) !== digest)
      throw Error(`Stale negative-form proof: ${path}`);
  for (const b of [...proof.originalBlocks, ...(proof.sourceBlocks ?? [])]) {
    if (
      !Number.isSafeInteger(b.rva) ||
      !Number.isSafeInteger(b.size) ||
      b.rva < 0 ||
      b.size <= 0 ||
      b.rva + b.size > image.length ||
      (await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256
    )
      throw Error("Original negative-form block differs");
    blocks.set(`${b.rva}:${b.size}`, b);
  }
  proofs.push({ name, sha256: inputs[resolve(path)], value: proof });
}
const [listener, render, absent] = proofs.map((p) => p.value);
if (
  !listener.scope.completeOriginalListenerExecuted ||
  listener.controls.length !== 256 ||
  !listener.controls.every(
    (c) =>
      c.resourceStackUnchanged &&
      c.heapUnchanged &&
      c.registeredComponentUnchanged,
  ) ||
  [render, absent].some(
    (p) =>
      p.boundary !== null ||
      !p.scope.completeOriginal129ListenerExecuted ||
      !p.heroConstructor ||
      p.packet.index !== 255 ||
      p.packet.nativeFlag !== false ||
      p.resourceGroupBefore !== p.resourceGroupAfter ||
      !p.appearanceStorageUnchanged ||
      !p.animationComponentUnchanged,
  ) ||
  !render.scope.originalCallbackRegistrationExecuted ||
  render.scope.registeredCallbackExecuted ||
  !render.scope.onlyOriginalRegistryPresenceConsumed ||
  render.animationComponentReads.length !== 0 ||
  absent.renderConstructorPrefix !== null ||
  !absent.visits.includes(0x30d642) ||
  !absent.visits.includes(0x15ef6c0)
)
  throw Error("Both original lazy branches and negative listener required");
const actor = render.actorKey;
if (
  absent.actorKey !== actor ||
  !manifest.actors[actor] ||
  !assets.actors[actor]
)
  throw Error("Static actor proof differs");
const sources = assets.actors[actor].sourceBins,
  sourceJson = [];
for (const source of sources) {
  const stem =
      source.sourceSha256 +
      "-" +
      manifest.toolchain.parserIdentity.slice(0, 16),
    bin = await raw(`${cache}/research/latest-effects/bins/${stem}.bin`),
    bytes = await raw(`${cache}/research/latest-effects/bins/${stem}.json`);
  if (
    (await sha256(bin)) !== source.sourceSha256 ||
    (await sha256(bytes)) !== source.jsonSha256
  )
    throw Error("Installed negative-form static bytes differ");
  sourceJson.push({
    source,
    data: JSON.parse(new TextDecoder().decode(bytes)),
  });
}
const skinSource = sourceJson.find(
    (s) => s.source.path === manifest.actors[actor].skinPath,
  ),
  skins = Object.values(skinSource.data).filter(
    (s) => s?.__type === "SkinCharacterDataProperties",
  );
if (skins.length !== 1) throw Error("One exact native skin source required");
const ordered = skins[0].skinUpgradeData?.mGearSkinUpgrades;
if (
  skins[0].skinUpgradeData?.__type !== "SkinUpgradeData" ||
  !Array.isArray(ordered) ||
  ordered.length !== 2 ||
  Object.keys(skins[0].skinUpgradeData).sort().join() !==
    "__type,mGearSkinUpgrades"
)
  throw Error("Exact bounded gear table required");
const gears = ordered.map((key) => {
  const matches = sourceJson.filter((s) => s.data[key]);
  if (matches.length !== 1)
    throw Error("Unique installed gear source required");
  const { source, data } = matches[0],
    gear = data[key],
    g = gear.mGearData,
    native = render.gearPrograms.find(
      (g) => g.identity === parseInt(key.slice(1, -1), 16),
    );
  if (
    gear.__type !== "GearSkinUpgrade" ||
    Object.keys(gear).sort().join() !== "__type,mGearData" ||
    g?.__type !== "GearData" ||
    Object.keys(g).sort().join() !==
      "__type,mCharacterSubmeshesToHide,mCharacterSubmeshesToShow,mVFXResourceResolver" ||
    JSON.stringify(g.mVFXResourceResolver) !==
      '{"__type":"ResourceResolver"}' ||
    !native ||
    native.resolverRowCount !== 0 ||
    !native.resolver ||
    ![g.mCharacterSubmeshesToHide, g.mCharacterSubmeshesToShow].every(
      (a) =>
        Array.isArray(a) &&
        a.length > 0 &&
        Array.from(a).every((x) => /^\{[0-9a-f]{8}\}$/.test(x)),
    )
  )
    throw Error(
      "Only original submesh-only empty-resolver gear program is supported",
    );
  return {
    identity: key,
    sourceSha256: source.sourceSha256,
    fieldHashes: native.fieldHashes,
    hiddenSubmeshes: g.mCharacterSubmeshesToHide,
    shownSubmeshes: g.mCharacterSubmeshesToShow,
    resourceRows: 0,
    replacementModel: null,
    replacementRig: null,
    replacementMaterials: null,
  };
});
const policy = "native-negative-form-conditional-prefix-v1",
  metadata = {
    schema: 1,
    kind: "prepared-negative-form-conditional-prefix",
    policy,
    build: profile.clientVersion,
    protocol: profile.protocolDigest,
    decoderImageSha256: profile.decoderImageSha256,
    effectsManifestSha256: await sha256(manifestBytes),
    request: { opcode: 129, index: 255, signedIndex: -1, nativeFlag: false },
    capabilities: [
      {
        actorKey: actor,
        character: manifest.actors[actor].character,
        skinId: manifest.actors[actor].skinId,
        skinPath: skinSource.source.path,
        skinSourceSha256: skinSource.source.sourceSha256,
        gears,
      },
    ],
    proofDigests: proofs.map((p) => ({ name: p.name, sha256: p.sha256 })),
    sourceBlocks: [...blocks.values()].filter(
      (b) =>
        (b.rva >= 0xbf8b0 && b.rva < 0xbf980) ||
        (b.rva >= 0xfdd00 && b.rva < 0xfde02) ||
        (b.rva >= 0x30d220 && b.rva < 0x30f500),
    ),
    scope: {
      staticBuildDataOnly: true,
      containsReplayEvents: false,
      containsUnitInstances: false,
      fullListenerBranchesProven: true,
      resourceIdentityPreserved: true,
      rigIdentityPreserved: true,
      submeshVisibilityPreserved: false,
      meshAcquisitionRecovered: false,
      nativeReplayAcceptance: null,
      snapshotRestorationRecovered: false,
      nativeSnapshotAcceptance: null,
    },
    omissions: [
      "form:lazy-submesh-visibility-and-material-preparation-not-replayed",
      "form:native-mesh-acquisition-and-render-readiness-unrecovered",
      "form:event47-callback-registration-not-replayed",
      "form:native-live-unit-request-acceptance-unrecovered",
      "form:snapshot-restoration-unimplemented-native-acceptance-unknown",
    ],
  };
const bytes = new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
  sha = await sha256(bytes),
  out = `${cache}/public/latest-negative-form-prefix/package.json`;
await mkdir(resolve(out, ".."), { recursive: true });
await Bun.write(out, bytes);
await raw(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Final negative-form input drift: ${path}`);
await Bun.write(
  `${cache}/research/negative-form-prefix-preparation.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "negative-form-conditional-prefix-static-preparation",
      packageSha256: sha,
      inputs,
      originalBlocksValidated: blocks.size,
      capabilities: metadata.capabilities.length,
      scope: metadata.scope,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ out, sha256: sha, originalBlocksValidated: blocks.size }),
);
