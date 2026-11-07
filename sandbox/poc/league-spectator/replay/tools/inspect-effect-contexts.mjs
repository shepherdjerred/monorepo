// Compare original identity and registry code in WASM, then bind real replay IDs.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeDecoder } from "../native-decoder.mjs";
import {
  createLatestEffectContexts,
  nativeCharacterEffectContextIdentity,
} from "../latest-effect-contexts.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  nativeBytes = await raw(`${cache}/research/effect-contexts-native.json`),
  reference = JSON.parse(new TextDecoder().decode(nativeBytes)),
  packageBytes = await raw(`${assets}/latest-effect-contexts/package.json`),
  manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  contexts = await createLatestEffectContexts({
    profile,
    image,
    packageBytes,
    effectsManifestBytes: manifestBytes,
  }),
  vendor = `${assets}/vendor/unicorn_x86_candidate.mjs`,
  { default: factory } = await import(pathToFileURL(vendor).href),
  uc = await factory(),
  native = new NativeDecoder(uc, profile, image, { captureWrites: false }),
  base = profile.imageBase,
  TEXT = 0x100e0000,
  HASH = 0x100e4000,
  equal = (a, b, message) => {
    if (a !== b) throw Error(message);
  };
for (const [name, digest] of Object.entries(reference.sources))
  equal(
    sha(await raw(`${root}/tools/${name}`)),
    digest,
    `Changed context native source: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  equal(sha(await raw(path)), digest, "Changed native context input");
equal(
  contexts.metadata.observationSha256,
  sha(nativeBytes),
  "Native context evidence differs",
);
let active = false;
native.engine.hook_add(
  uc.HOOK_BLOCK,
  (_e, address) => {
    const rva = Number(address) - base;
    if (
      !active ||
      ![
        [0x1442120, 0x1442169],
        [0x14371c0, 0x14371fc],
        [0x354280, 0x3542cd],
      ].some(([a, b]) => rva >= a && rva < b)
    )
      throw Error("Context execution escaped pure hash/registry code");
  },
  null,
  base,
  base + image.length - 1,
);
function call(rva, registers) {
  native.engine.context_restore(native.context);
  for (const [name, value] of Object.entries(registers))
    native.engine.reg_write_i64(uc[`X86_REG_${name}`], BigInt(value));
  active = true;
  try {
    native.call(base + rva);
  } finally {
    active = false;
  }
  return Number(native.engine.reg_read_i64(uc.X86_REG_RAX)) >>> 0;
}
const text = (value) =>
    native.engine.mem_write(TEXT, new TextEncoder().encode(value + "\0")),
  identities = [],
  lookups = [];
try {
  for (const c of [...reference.contexts, ...reference.boundaries]) {
    text("[Character]");
    let hash = call(0x1442120, { RDI: TEXT });
    for (const value of [c.name, String(c.skinId), c.namespace]) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, hash, true);
      native.engine.mem_write(HASH, b);
      text(value);
      call(0x14371c0, { RDI: HASH, RSI: TEXT });
      hash = native.readU32(HASH);
    }
    equal(hash, c.identity, "Original native/WASM context identity differs");
    equal(
      nativeCharacterEffectContextIdentity(c.name, c.skinId, c.namespace),
      hash,
      "Translated context identity differs",
    );
    identities.push({
      name: c.name,
      skinId: c.skinId,
      namespace: c.namespace,
      identity: hash,
    });
  }
  const tree = reference.registryObservation;
  for (const record of [
    { address: tree.address, bytesHex: tree.bytesHex },
    ...tree.nodes,
  ]) {
    const bytes = Uint8Array.from(Buffer.from(record.bytesHex, "hex"));
    if (
      record.address < 0x10400000 ||
      record.address + bytes.length > 0x12000000
    )
      throw Error("Native registry snapshot outside owned heap");
    // NativeDecoder's decoder arena ends at 10400000; map these constructor
    // outputs as a separate, read-only registry observation.
    const page = record.address & ~4095;
    if (!lookups.some((v) => v.mappedPage === page)) {
      native.engine.mem_map(page, 4096, uc.PROT_ALL);
      lookups.push({ mappedPage: page });
    }
    native.engine.mem_write(record.address, bytes);
  }
  lookups.length = 0;
  for (const v of tree.lookups) {
    const value = call(0x354280, { RDI: tree.address, RSI: v.identity });
    equal(
      value,
      v.result,
      "Original native/WASM context registry lookup differs",
    );
    lookups.push(v);
  }
} finally {
  native.close();
}
const report = await read(`${cache}/research/latest-semantics-effects.json`),
  bound = contexts.bindRequests(report),
  ids = new Set(),
  unknown = new Map(),
  counts = {
    contexts: reference.contexts.length,
    identityComparisons: identities.length,
    registryComparisons: lookups.length,
    creationRequests: bound.length,
    auxiliaryReferences: 0,
    preparedReferences: 0,
    allContextsPreparedRequests: 0,
    requestsWithPreparedResourceCandidate: 0,
  };
for (const request of bound) {
  if (request.allAuxiliaryContextsPrepared)
    counts.allContextsPreparedRequests++;
  let hasResource = false;
  for (const c of request.orderedAuxiliaryCandidates) {
    counts.auxiliaryReferences++;
    ids.add(c.identity);
    if (c.status === "prepared-character-context") counts.preparedReferences++;
    else unknown.set(c.identity, (unknown.get(c.identity) ?? 0) + 1);
    if (c.resourceStatus === "prepared-definition") hasResource = true;
  }
  if (hasResource) counts.requestsWithPreparedResourceCandidate++;
}
const sources = {};
for (const name of [
  "latest-effect-contexts.mjs",
  "native-decoder.mjs",
  "tools/inspect-effect-contexts.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-character-context-comparison",
  inputs,
  sources,
  nativeObservationSha256: sha(nativeBytes),
  packageSha256: sha(packageBytes),
  identities,
  lookups,
  counts,
  uniqueReplayContextIds: ids.size,
  unknownContextIds: Object.fromEntries(unknown),
  bindings: bound,
  mismatchCount: 0,
  scope: {
    originalRegistryAndHashWasmCompared: true,
    originalConstructorComparedViaNativeObservation: true,
    resourcePrecedenceVerified: false,
    fullLiveContextRegistryRecovered: false,
    factoryExecuted: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-contexts-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    counts,
    uniqueReplayContextIds: ids.size,
    unknownContextIds: result.unknownContextIds,
  }),
);
