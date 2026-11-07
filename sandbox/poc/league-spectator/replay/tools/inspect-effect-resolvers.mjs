// Compare authored map lookup and ordered auxiliary selection in native/WASM/JS.
// The original engine receives explicitly empty unit contexts in this component
// comparison. All-miss execution stops before the unprepared global stages.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
import { NativeDecoder } from "../native-decoder.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import {
  createLatestEffectResolvers,
  summarizeEffectResolverRequests,
} from "../latest-effect-resolvers.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (path) => {
    const b = await Bun.file(path).bytes();
    inputs[path] = sha(b);
    return b;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  check = (ok, message) => {
    if (!ok) throw Error(message);
  },
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  referenceBytes = await raw(`${cache}/research/effect-resolvers-native.json`),
  reference = JSON.parse(new TextDecoder().decode(referenceBytes)),
  manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  contextBytes = await raw(`${assets}/latest-effect-contexts/package.json`),
  packageBytes = await raw(`${assets}/latest-effect-resolvers/package.json`),
  contexts = await createLatestEffectContexts({
    profile,
    image,
    packageBytes: contextBytes,
    effectsManifestBytes: manifestBytes,
  }),
  resolvers = await createLatestEffectResolvers({
    profile,
    builtinContextPackageBytes: await raw(
      `${assets}/latest-builtin-resource-contexts/package.json`,
    ),
    packageBytes,
    effectsManifestBytes: manifestBytes,
    contexts,
  }),
  report = await read(`${cache}/research/latest-semantics-effects.json`),
  vendor = `${assets}/vendor/unicorn_x86_candidate.mjs`,
  { default: factory } = await import(pathToFileURL(vendor).href),
  uc = await factory(),
  native = new NativeDecoder(uc, profile, image, { captureWrites: false }),
  e = native.engine,
  base = profile.imageBase;
check(
  resolvers.metadata.observationSha256 === sha(referenceBytes),
  "Resolver native evidence differs",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Changed original resolver producer: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(sha(await raw(path)) === digest, "Changed native resolver input");
for (const b of reference.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Changed original resolver instructions",
  );
let active = false,
  stopping = false;
// Install before any translation so cached blocks cannot bypass the endpoint.
e.hook_add(
  uc.HOOK_CODE,
  () => {
    if (stopping) e.emu_stop();
  },
  null,
  base + 0x377a2d,
  base + 0x377a2d,
);
e.hook_add(
  uc.HOOK_BLOCK,
  (_e, address) => {
    const at = Number(address) - base;
    check(
      active &&
        [
          [0x16153d0, 0x1615440],
          [0x377890, 0x377a2e],
          [0x377b54, 0x377b67],
        ].some(([a, b]) => at >= a && at < b),
      "Resolver execution escaped admitted original lookup stages",
    );
  },
  null,
  base,
  base + image.length - 1,
);
const pages = new Set(),
  snapshots = [],
  actors = new Map(),
  byObject = new Map();
function mapSnapshot(address, hex) {
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  check(
    address >= 0x10400000 &&
      address + bytes.length <= 0x12000000 &&
      bytes.length > 0,
    "Resolver snapshot outside owned native heap",
  );
  for (
    let page = Math.floor(address / 4096) * 4096;
    page < address + bytes.length;
    page += 4096
  )
    if (!pages.has(page)) {
      e.mem_map(page, 4096, uc.PROT_ALL);
      pages.add(page);
    }
  e.mem_write(address, bytes);
  snapshots.push({ address, bytes });
}
function call(rva, registers, stopBeforeGlobal = false) {
  e.context_restore(native.context);
  for (const [name, value] of Object.entries(registers))
    e.reg_write_i64(uc[`X86_REG_${name}`], BigInt(value));
  active = true;
  stopping = stopBeforeGlobal;
  try {
    if (stopBeforeGlobal) {
      const stack = NativeDecoder.STACK + 0x200000 - 0x1000 + 8;
      native.u64(stack, 0x10009000);
      e.reg_write_i64(uc.X86_REG_RSP, BigInt(stack));
      e.emu_start(base + rva, base + 0x377a2d, 0, 100000);
      check(
        Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + 0x377a2d,
        "Auxiliary miss did not reach global boundary",
      );
    } else native.call(base + rva);
  } finally {
    active = false;
    stopping = false;
  }
  return Number(e.reg_read_i64(uc.X86_REG_RAX));
}
const counts = {
    loadedResolvers: 0,
    lookups: 0,
    replayAuxiliaryChains: 0,
    matchedAuxiliaryChains: 0,
    globalBoundaryStops: 0,
    immutableSnapshots: 0,
  },
  comparisons = [];
try {
  for (const c of reference.cases) {
    const context = contexts.metadata.contexts.find(
      (v) => v.actorKey === c.actorKey,
    );
    check(context, "Native resolver context absent");
    actors.set(c.actorKey, { ...c, identity: context.identity });
    if (c.status !== "native-resource-map-loaded") continue;
    const l = c.loaded;
    mapSnapshot(l.object, l.objectHex);
    mapSnapshot(l.mapAddress, l.mapBytesHex);
    byObject.set(l.object, context.identity);
    counts.loadedResolvers++;
  }
  for (const page of pages) e.mem_protect(page, 4096, uc.PROT_READ);
  for (const c of actors.values()) {
    for (const probe of c.probes) {
      native.u64(0x100e8000, probe.key);
      native.u64(0x100e8010, 0);
      const result = call(0x16153d0, {
          RDI: c.loaded.object,
          RSI: 0x100e8000,
          RDX: 0x100e8010,
        }),
        found = (result & 255) !== 0,
        value = Number(
          new DataView(native.read(0x100e8010, 8).buffer).getBigUint64(0, true),
        ),
        translated = resolvers.lookup(c.identity, probe.key);
      check(
        found === probe.found && value === probe.value,
        "Native/WASM resource lookup differs",
      );
      check(
        found
          ? translated.status === "matched-authored-reference" &&
              translated.referenceToken === value
          : translated.status === "key-absent",
        "JS/native resource lookup differs",
      );
      counts.lookups++;
    }
  }
  for (const chain of reference.chains) {
    const descriptor = report.effectDescriptors[chain.creationSequence];
    check(
      descriptor.resourceKey === chain.resourceKey &&
        JSON.stringify(descriptor.unresolvedAuxiliaryContextIds) ===
          JSON.stringify(chain.contextIds),
      "Native resolver chain differs from decoded request",
    );
    const objects = chain.contextIds.map((id) => {
      const actor = actors.get(contexts.lookup(id).actorKey);
      check(actor?.loaded, "Native resolver chain has an unprepared context");
      return actor.loaded.object;
    });
    e.mem_write(0x100e9000, new Uint8Array(0x40));
    for (const [i, obj] of objects.entries())
      native.u64(0x100ea000 + i * 8, obj);
    native.u64(0x100e9020, 0x100ea000);
    native.u64(0x100e9028, 0x100ea000 + objects.length * 8);
    native.u64(0x100e9030, 0x100ea000 + objects.length * 8);
    native.u64(0x100eb000, 0);
    const miss = chain.status === "continue-global-resolution",
      value = call(
        0x377890,
        {
          RDI: chain.resourceKey,
          RSI: 0x100e9000,
          RDX: 0x100e9020,
          RCX: 0,
          R8: 0x100eb000,
        },
        miss,
      ),
      owner = Number(
        new DataView(native.read(0x100eb000, 8).buffer).getBigUint64(0, true),
      ),
      translated = resolvers.selectAuxiliary(
        chain.contextIds,
        chain.resourceKey,
      );
    check(
      translated.status === chain.status,
      "Native/JS auxiliary selection state differs",
    );
    if (!miss) {
      check(
        value === chain.value &&
          owner === chain.owner &&
          translated.referenceToken === value &&
          translated.identity === byObject.get(owner),
        "Native/WASM/JS ordered resource owner/reference differs",
      );
      counts.matchedAuxiliaryChains++;
    } else counts.globalBoundaryStops++;
    counts.replayAuxiliaryChains++;
    comparisons.push({
      creationSequence: chain.creationSequence,
      status: chain.status,
      referenceToken: miss ? null : value,
      contextIdentity: miss ? null : byObject.get(owner),
    });
  }
  for (const snapshot of snapshots) {
    check(
      sha(native.read(snapshot.address, snapshot.bytes.length)) ===
        sha(snapshot.bytes),
      "Original resolver mutated an immutable authored map",
    );
    counts.immutableSnapshots++;
  }
} finally {
  native.close();
}
const requests = resolvers.bindRequests(report),
  summary = summarizeEffectResolverRequests(requests),
  sources = {};
const pipeline = await createLatestEffectPipeline({
    report,
    effectsManifestBytes: manifestBytes,
    quadGpuBytes: await raw(`${assets}/latest-complete-quad-gpu/package.json`),
    trailGpuBytes: await raw(`${assets}/latest-trail-particles/gpu.json`),
  }),
  joined = resolvers.bindTimeline(pipeline, report);
counts.timelineCreationJoins = 0;
counts.timelineEntityQueries = 0;
for (const [i, request] of requests.entries()) {
  const creation = joined.creation(i);
  check(
    isDeepStrictEqual(creation.resourceStages, request) &&
      Object.isFrozen(creation.resourceStages.auxiliary),
    "Canonical creation lost or exposed mutable auxiliary selection",
  );
  const { resourceStages, ...original } = creation;
  check(
    isDeepStrictEqual(original, pipeline.creation(i)),
    "Resource join changed the canonical creation",
  );
  counts.timelineCreationJoins++;
}
for (const event of [...pipeline.events, ...pipeline.events.toReversed()]) {
  const original = pipeline.sampleEntity(event.entityId, event.time),
    sample = joined.sampleEntity(event.entityId, event.time);
  check(
    isDeepStrictEqual(sample.state, original.state),
    "Resource join changed request lifecycle while seeking",
  );
  check(
    sample.creation === null
      ? original.creation === null
      : isDeepStrictEqual(
          sample.creation.resourceStages,
          requests[sample.state.creationSequence],
        ),
    "Forward/reverse seek selected another request generation's resource",
  );
  counts.timelineEntityQueries++;
}
check(
  isDeepStrictEqual(joined.resourceSummary, summary),
  "Joined resource summary differs",
);
for (const name of [
  "latest-effect-resolvers.mjs",
  "latest-effect-contexts.mjs",
  "latest-effect-pipeline.mjs",
  "latest-effect-creation.mjs",
  "native-decoder.mjs",
  "tools/prepare-effect-resolvers.mjs",
  "tools/inspect-effect-resolvers.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-authored-resolver-comparison",
  inputs,
  sources,
  nativeObservationSha256: sha(referenceBytes),
  packageSha256: sha(packageBytes),
  counts,
  summary,
  comparisons,
  requests,
  mismatchCount: 0,
  scope: {
    originalLookupAndAuxiliaryOrderWasmCompared: true,
    unitContextsSuppliedEmpty: true,
    immutableNativeMaps: true,
    globalResolutionExecuted: false,
    externalLinksResolved: false,
    completeFactoryPrecedenceVerified: false,
    effectFactoryExecuted: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-resolvers-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, summary }));
