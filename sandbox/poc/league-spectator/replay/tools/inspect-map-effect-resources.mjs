// Original native/WASM map merging/global lookup and JS catalog selection.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { NativeDecoder } from "../native-decoder.mjs";
import { NativeVfxSpawnKernel } from "../latest-vfx-spawn.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import {
  createLatestMapEffectResources,
  mergeNativeResourceRows,
  lookupNativeResourceRows,
  selectSuppliedGlobalResourceMaps,
} from "../latest-map-effect-resources.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  unhex = (h) => new Uint8Array(Buffer.from(h, "hex")),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  observationBytes = await raw(
    `${cache}/research/map-effect-resources-native.json`,
  ),
  observation = JSON.parse(new TextDecoder().decode(observationBytes)),
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  packageBytes = await raw(
    `${assets}/latest-map-effect-resources/package.json`,
  ),
  api = await createLatestMapEffectResources({ profile, packageBytes }),
  bulkBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkBytes)),
  runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createLatestBulkUnicorn(
    factory,
    runtimeBytes,
    bulkBytes,
    await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  ),
  native = new NativeDecoder(uc, profile, image, { captureWrites: false }),
  e = native.engine,
  base = profile.imageBase,
  initial = observation.mergeInitial,
  records = [...observation.maps, ...observation.controls],
  byId = new Map(records.map((r) => [r.id, r])),
  counts = {
    authoredMaps: 0,
    authoredRows: 0,
    mapLookups: 0,
    merges: 0,
    globalWorlds: 0,
    globalQueries: 0,
    nullReferenceMatches: 0,
    immutableWorldSnapshots: 0,
    decodedRequests: 0,
    catalogMatchedRequests: 0,
    detachedCatalogMatchedRequests: 0,
    mapDeclarations: 0,
    unresolvedStageComparisons: 0,
  };
check(
  observation.kind === "native-map-effect-resource-observations" &&
    observation.decoderImageSha256 === sha(image) &&
    api.metadata.observationSha256 === sha(observationBytes) &&
    observation.counts.maps === 17 &&
    observation.counts.rows === 505 &&
    observation.counts.merges === 15 &&
    observation.counts.globalQueries === 2550,
  "Complete map/global native observation required",
);
for (const [name, digest] of Object.entries(observation.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Map native producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(observation.inputs))
  check(sha(await raw(path)) === digest, "Map native input changed");
for (const b of observation.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original map/global instructions changed",
  );
e.mem_map(0x10400000, 0x1c00000, uc.PROT_ALL);
e.mem_protect(base + 0x9000, 0x1fef000 - 0x9000, uc.PROT_READ | uc.PROT_EXEC);
let active = false,
  writable = false;
const allocators = new Set([0x1474a30, 0x14766c0, 0x149a2f0, 0x149a460]),
  services = new Set([
    ...allocators,
    0x1474970,
    0x149a350,
    0x1feea44,
    0x1feea4a,
  ]);
Object.assign(native, {
  a: { stack: 0x10010008, stop: 0x10000000 },
  base,
  nextHeap: initial.nextHeap,
  allocations: new Map(initial.allocations),
  services: {},
});
for (const method of ["allocate", "ret", "put", "q", "service"])
  native[method] = NativeVfxSpawnKernel.prototype[method];
for (const at of services)
  e.hook_add(
    uc.HOOK_CODE,
    () => {
      check(active && writable, "Unscoped map allocation/copy service");
      if (at === 0x149a460) {
        e.reg_write_i64(
          uc.X86_REG_RAX,
          BigInt(native.allocate(Number(e.reg_read_i64(uc.X86_REG_RDI)))),
        );
        native.ret();
      } else native.service(at);
    },
    null,
    base + at,
    base + at,
  );
e.hook_add(
  uc.HOOK_BLOCK,
  (_e, address, size) => {
    const at = Number(address) - base;
    check(active, "Unscoped map/global native block");
    if (services.has(at)) return;
    check(
      observation.originalBlocks.some(
        (b) => at >= b.rva && at + size <= b.rva + b.size,
      ),
      `Map/global execution escaped observed original blocks: ${at.toString(16)}`,
    );
  },
  null,
  base,
  base + image.length - 1,
);
function call(rva, registers) {
  e.context_restore(native.context);
  for (const [name, value] of Object.entries(registers))
    e.reg_write_i64(uc[`X86_REG_${name}`], BigInt(value));
  active = true;
  try {
    native.call(base + rva);
  } finally {
    active = false;
  }
  return Number(e.reg_read_i64(uc.X86_REG_RAX));
}
const sourceRows = (id) =>
  byId.get(id).rows.map(({ key, value }) => ({ key, referenceToken: value }));
function mapRows(object) {
  const count = native.readU32(object + 0x10),
    table = native.q(object + 8),
    rows = [];
  check(count <= 65536, "WASM map row bound exceeded");
  for (let i = 0; i < count; i++)
    rows.push({
      key: native.readU32(table + i * 16),
      value: native.q(table + i * 16 + 8),
    });
  return rows;
}
try {
  const heap = unhex(initial.heapHex);
  e.mem_write(0x10400000, heap);
  e.mem_protect(0x10400000, 0x1c00000, uc.PROT_READ);
  for (const record of records) {
    const keys = [
      ...new Set([...record.rows.map((r) => r.key), 0, 1, 0xffffffff]),
    ];
    for (const key of keys) {
      native.u64(0x100e8000, key);
      native.u64(0x100e8010, 0);
      const found = !!(
          call(0x16153d0, {
            RDI: record.object,
            RSI: 0x100e8000,
            RDX: 0x100e8010,
          }) & 255
        ),
        value = native.q(0x100e8010),
        expected = lookupNativeResourceRows(sourceRows(record.id), key);
      check(
        found === (expected !== undefined) && value === (expected ?? 0),
        "Original/native/WASM map lookup differs",
      );
      if (!record.synthetic) {
        const selected = api.lookupMap(record.id, key);
        check(
          expected === undefined
            ? selected.status === "key-absent"
            : selected.referenceToken === expected,
          "Public map lookup differs from the original reader",
        );
      }
      counts.mapLookups++;
    }
    if (!record.synthetic) {
      counts.authoredMaps++;
      counts.authoredRows += record.rows.length;
    }
  }
  check(
    sha(native.read(0x10400000, heap.length)) === sha(heap),
    "Map lookup mutated native source maps",
  );
  counts.immutableWorldSnapshots++;
  e.mem_protect(0x10400000, 0x1c00000, uc.PROT_ALL);
  writable = true;
  for (const expected of observation.merges) {
    const object = native.allocate(24);
    call(0x16659b0, { RDI: object });
    for (const id of expected.sources)
      call(0x16154a0, { RDI: object, RSI: byId.get(id).object });
    const rows = mapRows(object),
      translated = mergeNativeResourceRows(expected.sources.map(sourceRows));
    check(
      object === expected.object &&
        isDeepStrictEqual(rows, expected.rows) &&
        isDeepStrictEqual(unhex(expected.objectHex), native.read(object, 24)) &&
        (!expected.mapHex ||
          isDeepStrictEqual(
            unhex(expected.mapHex),
            native.read(expected.mapAddress, expected.rows.length * 16),
          )),
      "Original native/WASM resource map merge differs",
    );
    check(
      isDeepStrictEqual(
        rows.map(({ key, value }) => ({ key, referenceToken: value })),
        translated,
      ),
      "JS resource merge differs from original stable ordering",
    );
    if (expected.skinId !== null)
      check(
        isDeepStrictEqual(api.mergedMapSkin(expected.skinId), translated),
        "Public map-skin merge differs",
      );
    counts.merges++;
  }
  writable = false;
  for (const world of observation.worlds) {
    e.mem_protect(0x10400000, 0x1c00000, uc.PROT_ALL);
    const heap = unhex(world.snapshot.heapHex);
    e.mem_write(0x10400000, heap);
    for (const g of world.snapshot.globals)
      e.mem_write(base + g.rva, unhex(g.bytesHex));
    e.mem_protect(0x10400000, 0x1c00000, uc.PROT_READ);
    const handle = (id) => (id === null ? null : { id, rows: sourceRows(id) }),
      group = (g) =>
        g === null
          ? null
          : {
              status: "supplied-global-resource-stack",
              base: handle(g.base),
              overlays: g.overlays.map(handle),
            },
      supplied = {
        first: group(world.first),
        second: group(world.second),
        registered: {
          status: "supplied-registered-resource-maps",
          maps: world.registeredSources.map(handle),
        },
      };
    for (const expected of world.queries) {
      e.mem_write(0x100e9000, new Uint8Array(0x40));
      native.u64(0x100eb000, 0);
      const value = call(0x377890, {
          RDI: expected.key,
          RSI: 0x100e9000,
          RDX: 0x100e9020,
          RCX: 0,
          R8: 0x100eb000,
        }),
        owner = native.q(0x100eb000),
        selected = selectSuppliedGlobalResourceMaps(supplied, expected.key);
      check(
        value === expected.value && owner === expected.selectedResolver,
        "Original native/WASM complete global lookup differs",
      );
      check(
        (selected.status === "matched-authored-reference"
          ? selected.referenceToken
          : 0) === value,
        "JS global resource precedence differs",
      );
      if (
        selected.status === "matched-authored-reference" &&
        selected.referenceToken === 0
      )
        counts.nullReferenceMatches++;
      counts.globalQueries++;
    }
    check(
      sha(native.read(0x10400000, heap.length)) === sha(heap),
      "Global lookup mutated supplied maps/components",
    );
    for (const g of world.snapshot.globals)
      check(
        isDeepStrictEqual(
          native.read(base + g.rva, g.bytesHex.length / 2),
          unhex(g.bytesHex),
        ),
        "Global lookup mutated its registry",
      );
    counts.immutableWorldSnapshots++;
    counts.globalWorlds++;
  }
} finally {
  native.close();
}
const definitions = await api.definitions(
  await raw(`${assets}/latest-map-effect-inputs/definitions.json`),
);
counts.mapDeclarations = Object.keys(definitions).length;
for (const supplied of [
  {
    first: { status: "unresolved-global-resource-stack" },
    second: null,
    registered: {
      status: "supplied-registered-resource-maps",
      maps: ["79372a74"],
    },
  },
  {
    first: null,
    second: { status: "unresolved-global-resource-stack" },
    registered: {
      status: "supplied-registered-resource-maps",
      maps: ["79372a74"],
    },
  },
  {
    first: null,
    second: null,
    registered: { status: "unresolved-registered-resource-maps" },
  },
]) {
  const selected = api.selectGlobals(supplied, 0x47cba8aa);
  check(
    selected.status.startsWith("unresolved-") &&
      !Object.hasOwn(selected, "referenceToken"),
    "Unknown earlier global state was bypassed by a later catalog match",
  );
  counts.unresolvedStageComparisons++;
}
check(
  Object.isFrozen(api.metadata.maps["79372a74"].rows) &&
    Object.isFrozen(definitions),
  "Public map resource/declaration snapshots remain mutable",
);
const replay = await read(`${cache}/research/latest-semantics-effects.json`),
  requestCandidates = [],
  byMap = {};
check(
  replay.build === api.metadata.build &&
    replay.protocol === api.metadata.protocol,
  "Replay/map resource builds differ",
);
for (const d of replay.effectDescriptors) {
  const candidates = api.candidates(d.resourceKey);
  counts.decodedRequests++;
  if (candidates.matches.length) {
    counts.catalogMatchedRequests++;
    if (
      [
        "resourceContextEntityId",
        "attachmentEntityId",
        "lookup14EntityId",
        "lookupA8EntityId",
      ].every((f) => d[f] === 0)
    )
      counts.detachedCatalogMatchedRequests++;
    for (const m of candidates.matches)
      byMap[m.mapId] = (byMap[m.mapId] ?? 0) + 1;
    requestCandidates.push({
      creationSequence: d.creationSequence,
      entityId: d.entityId,
      ...candidates,
    });
  }
}
const browser = await Bun.build({
  entrypoints: [`${root}/latest-map-effect-resources.mjs`],
  target: "browser",
  write: false,
});
check(browser.success, "Map resource browser bundle failed");
const sources = {};
for (const name of [
  "latest-map-effect-resources.mjs",
  "latest-unicorn-bulk.mjs",
  "latest-vfx-spawn.mjs",
  "native-decoder.mjs",
  "tools/prepare-map-effect-inputs.mjs",
  "tools/prepare-map-effect-resources.mjs",
  "tools/inspect-map-effect-resources.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-map-global-resource-comparison",
  nativeObservationSha256: sha(observationBytes),
  packageSha256: sha(packageBytes),
  inputs,
  sources,
  counts,
  byMap,
  requestCandidates,
  mismatchCount: 0,
  scope: {
    originalMapMergeWasmCompared: true,
    completeGlobalLookupWasmCompared: true,
    globalWorldSnapshotsReadOnly: true,
    javascriptPolicyCompared: true,
    completeMapDeclarationsLoaded: true,
    replayCatalogJoinOnly: true,
    suppliedGlobalStacks: true,
    mapValuesAreReferenceTokens: true,
    activeMapVariantRecovered: false,
    activeGuestRecovered: false,
    externalLinksResolved: false,
    completeFactoryPrecedenceVerified: false,
    worldFactoryExecuted: false,
    browserBundleBuilt: true,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/map-effect-resources-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, byMap, mismatchCount: 0 }));
