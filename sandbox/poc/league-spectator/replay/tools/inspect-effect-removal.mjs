// Independent packet, getter, resolved-native routing and reconstruction checks.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import {
  createLatestEffectRemovalReader,
  EFFECT_REMOVAL_PACKAGE_SHA,
} from "../latest-effect-removal.mjs";
import { createLatestVfxBoundQuads } from "../latest-vfx-bound-quads.mjs";
import { createLatestVfxRetirement } from "../latest-vfx-retirement.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-effect-removal.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  decoder = `${cache}/public/decoder-16.21-macos`,
  inputs = {};
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    inputs[path] = sha(bytes);
    return bytes;
  },
  json = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  hex = (bytes) => Buffer.from(bytes).toString("hex");
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  constructors = await raw(`${decoder}/constructors.bin`),
  nativePath = `${cache}/research/effect-removal-native.json`,
  native = await json(nativePath),
  samples = await json(`${cache}/research/effect-removal-input.json`),
  objects = await json(`${cache}/research/effect-removal-objects-native.json`),
  packageBytes = await raw(
    `${cache}/public/latest-effect-removal/package.json`,
  ),
  reportPath = `${cache}/research/latest-semantics-creations.json`,
  report = await json(reportPath),
  legacy = await json(`${cache}/research/latest-semantics.json`),
  vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
requireThat(
  sha(packageBytes) === native.packageSha256 &&
    native.packageSha256 === EFFECT_REMOVAL_PACKAGE_SHA &&
    sha(constructors) === profile.constructorImageSha256 &&
    samples.replaySha256 === report.replaySha256,
  "Removal package/replay changed",
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
    "Observed removal code changed",
  );
requireThat(
  sha(await raw(vendor)) ===
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  "Removal runtime changed",
);
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  reader = await createLatestEffectRemovalReader(profile, image, packageBytes),
  structural = new StructuralDecoder(uc, profile, image, constructors);
let packetChecks = 0,
  mixedChecks = 0,
  routingChecks = 0;
try {
  for (const record of native.records) {
    const sample = samples.packets[record.key],
      expected = objects.observations[record.key],
      observed = structural.observePacket(
        187,
        Buffer.from(sample.payloadHex, "hex"),
        sample.param,
      ),
      decoded = reader.read(observed);
    requireThat(
      observed.complete &&
        observed.consumed === expected.consumed &&
        hex(observed.object) === expected.object &&
        hex(observed.heap) === expected.heap,
      `Removal native/WASM packet differs: ${record.key}`,
    );
    requireThat(
      ["entityId", "reasonByte", "contextId", "requestedFlagMask"].every(
        (field) => decoded[field] === record[field],
      ),
      `Removal original getter differs: ${record.key}`,
    );
    const reconstructed = report.effectRemovals[packetChecks];
    requireThat(
      [
        "entityId",
        "reasonByte",
        "contextId",
        "requestedFlagMask",
        "time",
        "chunkId",
        "blockOffset",
        "stream",
      ].every((field) => reconstructed[field] === record[field]) &&
        reconstructed.removalSequence === packetChecks &&
        Number.isSafeInteger(reconstructed.transportSequence) &&
        (packetChecks === 0 ||
          reconstructed.transportSequence >
            report.effectRemovals[packetChecks - 1].transportSequence),
      "Main reconstruction removal order differs",
    );
    packetChecks++;
  }
  for (const probe of native.mixedProbes) {
    const object = new Uint8Array(24);
    new DataView(object.buffer).setUint32(8, 187, true);
    object.set(Buffer.from(probe.encodedHex, "hex"), 20);
    requireThat(
      reader.read({ complete: true, object }).entityId === probe.entityId,
      "Mixed native removal ID differs",
    );
    mixedChecks++;
  }
} finally {
  structural.close();
}
const cohort = await json(`${cache}/research/vfx-retirement-native.json`),
  ref = cohort.cases[0].ref,
  retirementBytes = await raw(
    `${cache}/public/latest-vfx-retirement/package.json`,
  ),
  runtime = await createLatestVfxBoundQuads(
    uc,
    profile,
    image,
    await raw(`${decoder}/vfx-spawn.json`),
    await raw(`${decoder}/vfx-emitter.json`),
    await raw(`${decoder}/vfx-postload.json`),
    await raw(`${decoder}/vfx-bound-quads.json`),
    await raw(`${decoder}/${ref.file}`),
  ),
  retirement = await createLatestVfxRetirement(
    runtime,
    profile,
    image,
    retirementBytes,
    cohort.packageSha256,
  );
try {
  runtime.reset(1n, 0);
  retirement.initialize(0);
  const k = runtime.kernel;
  for (const probe of native.routing) {
    k.engine.mem_write(k.a.system + 0x2a9, new Uint8Array(2));
    k.put(k.a.manager + 0x1d8, [0], "u32");
    const result = reader.routeResolvedParticleEntity(
      retirement,
      probe.reasonByte,
      probe.initialObjectFlags,
      probe.effectPresent,
    );
    requireThat(
      JSON.stringify(result) === JSON.stringify(probe),
      `Original resolved removal route differs: ${routingChecks}`,
    );
    routingChecks++;
  }
} finally {
  retirement.close();
  runtime.close();
}
const legacyFields = Object.keys(legacy).filter(
  (key) => !["summary", "decodedPackets", "unhandledOpcodes"].includes(key),
);
for (const key of legacyFields)
  requireThat(
    JSON.stringify(report[key]) === JSON.stringify(legacy[key]),
    `Existing reconstructed field changed: ${key}`,
  );
for (const [key, value] of Object.entries(legacy.summary))
  requireThat(report.summary[key] === value, `Existing count changed: ${key}`);
const decoded = { ...report.decodedPackets },
  unhandled = { ...legacy.unhandledOpcodes };
delete decoded[187];
delete decoded[756];
delete unhandled[187];
delete unhandled[756];
requireThat(
  JSON.stringify(decoded) === JSON.stringify(legacy.decodedPackets) &&
    JSON.stringify(unhandled) === JSON.stringify(report.unhandledOpcodes) &&
    report.decodedPackets[187] === packetChecks &&
    report.effectRemovalPackageSha256 === EFFECT_REMOVAL_PACKAGE_SHA,
  "Packet coverage drifted beyond opcodes 187/756",
);
const missileIds = new Set(report.missiles.map((r) => r.entityId)),
  worldIds = new Set(report.worldEvents.map((r) => r.entityId)),
  reasons = {};
for (const r of report.effectRemovals)
  reasons[r.reasonByte] = (reasons[r.reasonByte] ?? 0) + 1;
const sources = {};
for (const name of [
  "latest-effect-removal.mjs",
  "latest-effect-creation.mjs",
  "latest-reconstruction.mjs",
  "structural-check-worker.mjs",
  "structural-decoder.mjs",
  "structural-comparison.mjs",
  "native-decoder.mjs",
  "latest-vfx-retirement.mjs",
  "latest-vfx-bound-quads.mjs",
  "latest-vfx-legacy-quads.mjs",
  "latest-vfx-spawn.mjs",
  "latest-vfx-emitter.mjs",
  "transport.mjs",
  "tools/inspect-latest-semantics.mjs",
  "tools/sample-structural.mjs",
  "tools/observe-structural.py",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  packetChecks,
  mixedChecks,
  routingChecks,
  records: report.effectRemovals.length,
  uniqueEntityIds: new Set(report.effectRemovals.map((r) => r.entityId)).size,
  creationIdsJoined: new Set(
    report.effectRemovals
      .filter((removal) =>
        report.effectCreations.some(
          (creation) =>
            creation.entityId === removal.entityId &&
            (creation.time < removal.time ||
              (creation.time === removal.time &&
                creation.transportSequence <= removal.transportSequence)),
        ),
      )
      .map((removal) => removal.entityId),
  ).size,
  missileJoins: report.effectRemovals.filter((r) => missileIds.has(r.entityId))
    .length,
  worldJoins: report.effectRemovals.filter((r) => worldIds.has(r.entityId))
    .length,
  reasonCounts: reasons,
  unchangedLegacyFields: legacyFields.length,
  unhandledTypes: Object.keys(report.unhandledOpcodes).length,
};
await Bun.write(
  `${cache}/research/effect-removal-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "particle-entity-removal-comparison",
      build: report.build,
      packageSha256: EFFECT_REMOVAL_PACKAGE_SHA,
      nativeEvidenceSha256: inputs[nativePath],
      reconstructionSha256: inputs[reportPath],
      inspectorSha256: sha(await raw(import.meta.path)),
      sources,
      inputs,
      counts,
      mismatches: [],
      scope: {
        mainDecoderSourceIntegrated: true,
        legacySequencePreserved: true,
        worldRegistryExecuted: false,
        typeCastExecuted: false,
        worldLookupResolvedByCaller: true,
        particleCreationJoined: true,
        missilePresentationInterfaceBound: false,
        renderingIntegrated: false,
        browserRun: false,
        leagueReferenceCompared: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
