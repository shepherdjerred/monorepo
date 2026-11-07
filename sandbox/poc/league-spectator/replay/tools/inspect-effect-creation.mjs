// Compare native getters, WASM packet construction and main reconstruction.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import {
  createLatestEffectCreationReader,
  bindLatestCreationResources,
  EFFECT_CREATION_PACKAGE_SHA,
} from "../latest-effect-creation.mjs";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-effect-creation.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  decoder = `${cache}/public/decoder-16.21-macos`,
  inputs = {};
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const value = new Uint8Array(await Bun.file(path).arrayBuffer());
    inputs[path] = sha(value);
    return value;
  },
  json = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  hex = (bytes) => Buffer.from(bytes).toString("hex");
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  constructors = await raw(`${decoder}/constructors.bin`),
  nativePath = `${cache}/research/effect-creation-native.json`,
  native = await json(nativePath),
  samples = await json(`${cache}/research/effect-creation-input.json`),
  objects = await json(`${cache}/research/effect-creation-objects-native.json`),
  packageBytes = await raw(
    `${cache}/public/latest-effect-creation/package.json`,
  ),
  reportPath = `${cache}/research/latest-semantics-creations.json`,
  report = await json(reportPath),
  legacy = await json(`${cache}/research/latest-semantics.json`),
  prior = await json(`${cache}/research/latest-semantics-removals.json`),
  effects = await json(`${cache}/public/latest-effects/manifest.json`),
  vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
requireThat(
  sha(packageBytes) === native.packageSha256 &&
    native.packageSha256 === EFFECT_CREATION_PACKAGE_SHA &&
    report.effectCreationPackageSha256 === EFFECT_CREATION_PACKAGE_SHA &&
    sha(constructors) === profile.constructorImageSha256 &&
    samples.replaySha256 === report.replaySha256 &&
    sha(await raw(vendor)) ===
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  "Creation package, runtime or fixture changed",
);
for (const [name, expected] of Object.entries(native.sources))
  requireThat(
    sha(await raw(`${root}/tools/${name}`)) === expected,
    `Stale native source: ${name}`,
  );
for (const [path, expected] of Object.entries(native.inputs))
  requireThat(sha(await raw(path)) === expected, `Stale native input: ${path}`);
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Executed creation block changed",
  );
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  reader = await createLatestEffectCreationReader(profile, image, packageBytes),
  structural = new StructuralDecoder(
    await createUnicorn(),
    profile,
    image,
    constructors,
  );
let packetChecks = 0,
  entryChecks = 0,
  mixedChecks = 0;
const recordsByPacket = Map.groupBy(native.records, (record) => record.key);
try {
  for (const [key, sample] of Object.entries(samples.packets)) {
    const expected = objects.observations[key],
      observed = structural.observePacket(
        756,
        Buffer.from(sample.payloadHex, "hex"),
        sample.param,
      ),
      decoded = reader.read(observed),
      nativeRecords = recordsByPacket.get(key) ?? [];
    requireThat(
      observed.complete &&
        observed.consumed === expected.consumed &&
        hex(observed.object) === expected.object &&
        hex(observed.heap) === expected.heap &&
        decoded.length === nativeRecords.length,
      `Creation packet differs: ${key}`,
    );
    for (let index = 0; index < decoded.length; index++) {
      const value = decoded[index],
        nativeRecord = nativeRecords[index],
        actual = report.effectCreations[entryChecks];
      const keys = [
        ...Object.keys(reader.metadata.fields),
        "groupIndex",
        "entryIndex",
      ];
      requireThat(
        keys.every(
          (name) =>
            value[name] === nativeRecord[name] &&
            actual[name] === nativeRecord[name],
        ) &&
          ["time", "chunkId", "blockOffset", "stream", "contextId"].every(
            (name) => actual[name] === nativeRecord[name],
          ) &&
          actual.creationSequence === entryChecks &&
          Number.isSafeInteger(actual.transportSequence) &&
          (entryChecks === 0 ||
            actual.transportSequence >=
              report.effectCreations[entryChecks - 1].transportSequence) &&
          JSON.stringify(actual.positionFields) ===
            JSON.stringify(value.positionFields),
        `Creation getter/report differs: ${key}/${index}`,
      );
      // Independently reinterpret the native getter's unsigned bits.
      const heightBytes = Buffer.alloc(4);
      heightBytes.writeUInt32LE(nativeRecord.positionHeightBits);
      requireThat(
        value.positionFields.xGrid ===
          (nativeRecord.positionXGridBits << 16) >> 16 &&
          value.positionFields.zGrid ===
            (nativeRecord.positionZGridBits << 16) >> 16 &&
          value.positionFields.height === heightBytes.readFloatLE() &&
          !value.positionFields.worldPositionResolved &&
          !value.positionFields.attachmentOverrideResolved,
        "Creation position interpretation changed",
      );
      entryChecks++;
    }
    packetChecks++;
  }
  for (const probe of native.mixedProbes) {
    requireThat(
      reader.decodeField(probe.field, Buffer.from(probe.encodedHex, "hex")) ===
        probe.value,
      "Mixed native creation getter differs",
    );
    mixedChecks++;
  }
} finally {
  structural.close();
}
requireThat(
  entryChecks === report.effectCreations.length &&
    entryChecks === native.counts.entries,
  "Creation entries missing",
);
// Existing sequence IDs bind the prepared missile data. Preserve every old
// field and all prior removal records, including their transport ordinals.
const unchanged = Object.keys(legacy).filter(
  (key) => !["summary", "decodedPackets", "unhandledOpcodes"].includes(key),
);
for (const key of unchanged)
  requireThat(
    JSON.stringify(report[key]) === JSON.stringify(legacy[key]),
    `Existing field changed: ${key}`,
  );
for (const [key, value] of Object.entries(legacy.summary))
  requireThat(report.summary[key] === value, `Existing count changed: ${key}`);
requireThat(
  JSON.stringify(report.effectRemovals) ===
    JSON.stringify(prior.effectRemovals),
  "Removal stream changed",
);
const expectedDecoded = {
    ...legacy.decodedPackets,
    187: prior.decodedPackets[187],
    756: packetChecks,
  },
  expectedUnhandled = { ...legacy.unhandledOpcodes };
delete expectedUnhandled[187];
delete expectedUnhandled[756];
requireThat(
  JSON.stringify(report.decodedPackets) === JSON.stringify(expectedDecoded) &&
    JSON.stringify(report.unhandledOpcodes) ===
      JSON.stringify(expectedUnhandled),
  "Coverage drift beyond creation/removal",
);

const bindings = bindLatestCreationResources(report, effects),
  byId = new Map(
    report.effectCreations.map((record) => [record.entityId, record]),
  ),
  heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero])),
  bindingCounts = {},
  removalRequests = [],
  joinedIds = new Set();
for (const [index, binding] of bindings.entries()) {
  const record = report.effectCreations[index],
    hero = heroes.get(record.resourceContextEntityId);
  if (binding.status === "prepared-context-resource") {
    const actorKey = `champions/${hero.champion.toLowerCase()}/${hero.skinId}`,
      resource =
        effects.actors[actorKey].resources[
          record.resourceKey.toString(16).padStart(8, "0")
        ];
    requireThat(
      resource.status === "prepared-definition" &&
        resource.effectId === binding.effectId &&
        effects.definitions[binding.effectId] &&
        binding.actorKey === actorKey,
      "Binding does not belong to explicit context skin",
    );
  }
  bindingCounts[binding.status] = (bindingCounts[binding.status] ?? 0) + 1;
}
for (const removal of report.effectRemovals) {
  const creation = byId.get(removal.entityId);
  let status = "creation-not-observed";
  if (creation) {
    status =
      removal.time > creation.time ||
      (removal.time === creation.time &&
        removal.transportSequence >= creation.transportSequence)
        ? "creation-before-removal-request"
        : "removal-before-observed-creation";
    if (status === "creation-before-removal-request")
      joinedIds.add(creation.entityId);
  }
  removalRequests.push({
    entityId: removal.entityId,
    removalSequence: removal.removalSequence,
    creationSequence: creation?.creationSequence ?? null,
    time: removal.time,
    creationTime: creation?.time ?? null,
    reasonByte: removal.reasonByte,
    status,
  });
}
const sources = {};
for (const name of [
  "latest-effect-creation.mjs",
  "latest-reconstruction.mjs",
  "structural-check-worker.mjs",
  "structural-decoder.mjs",
  "structural-comparison.mjs",
  "native-decoder.mjs",
  "transport.mjs",
  "latest-fields.mjs",
  "latest-effect-removal.mjs",
  "tools/inspect-latest-semantics.mjs",
  "tools/sample-structural.mjs",
  "tools/observe-structural.py",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  packetChecks,
  entryChecks,
  mixedChecks,
  groups: native.counts.groups,
  uniqueIds: byId.size,
  uniqueResourceKeys: new Set(
    report.effectCreations.map((record) => record.resourceKey),
  ).size,
  startupEntries: report.effectCreations.filter((record) => record.stream === 2)
    .length,
  gameplayEntries: report.effectCreations.filter(
    (record) => record.stream === 1,
  ).length,
  bindingCounts,
  removalRequestCounts: Object.fromEntries(
    [...Map.groupBy(removalRequests, (record) => record.status)].map(
      ([key, values]) => [key, values.length],
    ),
  ),
  createdIdsWithRemoval: joinedIds.size,
  unchangedLegacyFields: unchanged.length,
  unhandledTypes: Object.keys(report.unhandledOpcodes).length,
};
const proof = {
  schema: 1,
  kind: "particle-creation-comparison",
  build: report.build,
  protocol: report.protocol,
  packageSha256: EFFECT_CREATION_PACKAGE_SHA,
  nativeEvidenceSha256: inputs[nativePath],
  reconstructionSha256: inputs[reportPath],
  inspectorSha256: sha(await raw(import.meta.path)),
  sources,
  inputs,
  counts,
  bindings,
  removalRequests,
  mismatches: [],
  scope: {
    mainDecoderSourceIntegrated: true,
    legacySequencePreserved: true,
    contextCatalogLookup: true,
    worldRegistryExecuted: false,
    factoryExecuted: false,
    mapOriginConversionExecuted: false,
    attachmentPoseExecuted: false,
    renderingIntegrated: false,
    browserRun: false,
    leagueReferenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-creation-comparison.json`,
  JSON.stringify(proof, null, 2),
);
console.log(JSON.stringify(counts));
