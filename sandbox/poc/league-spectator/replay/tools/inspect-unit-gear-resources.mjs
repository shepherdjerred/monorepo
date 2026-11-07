// Original ResourceResolver lookup in WASM on read-only native loaded objects.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeDecoder } from "../native-decoder.mjs";
import {
  createLatestUnitGearResources,
  UNIT_GEAR_RESOURCES_SHA,
} from "../latest-unit-gear-resources.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  assets = `${cache}/public`,
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  packageBytes = await raw(`${assets}/latest-unit-gear-resources/package.json`),
  reference = await read(`${cache}/research/unit-gear-resources-native.json`),
  policy = await createLatestUnitGearResources({
    profile,
    image,
    packageBytes,
  });
check(
  sha(packageBytes) === UNIT_GEAR_RESOURCES_SHA &&
    policy.metadata.observationSha256 ===
      sha(await raw(`${cache}/research/unit-gear-resources-native.json`)),
  "Matching authored gear native observation required",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native gear source changed: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(sha(await raw(path)) === digest, "Native gear input changed");
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new NativeDecoder(uc, profile, image, { captureWrites: false }),
  e = native.engine,
  heap = Uint8Array.from(Buffer.from(reference.heapHex, "hex")),
  start = reference.heapAddress,
  page = Math.floor(start / 4096) * 4096,
  end = Math.ceil((start + heap.length) / 4096) * 4096;
check(
  start === 0x10400000 && end <= 0x12000000,
  "Native gear snapshot outside owned heap",
);
e.mem_map(page, end - page, uc.PROT_ALL);
e.mem_write(start, heap);
e.mem_protect(page, end - page, uc.PROT_READ);
const counts = {
    gearEntries: 0,
    wasmLookups: 0,
    authoredRowComparisons: 0,
    duplicateKeyComparisons: 0,
    nullMatches: 0,
    nullResolvers: 0,
    invalidIndexRejections: 0,
    immutableResults: 0,
  },
  results = [];
function originalLookup(resolver, key) {
  e.context_restore(native.context);
  const encoded = new Uint8Array(4);
  new DataView(encoded.buffer).setUint32(0, key, true);
  e.mem_write(0x10010000, encoded);
  native.u64(0x10010010, 0);
  e.reg_write_i64(uc.X86_REG_RDI, BigInt(resolver));
  e.reg_write_i64(uc.X86_REG_RSI, 0x10010000n);
  e.reg_write_i64(uc.X86_REG_RDX, 0x10010010n);
  native.call(profile.imageBase + 0x16153d0);
  counts.wasmLookups++;
  return {
    found: Boolean(e.reg_read_i64(uc.X86_REG_RAX) & 255n),
    value: Number(
      new DataView(native.read(0x10010010, 8).buffer).getBigUint64(0, true),
    ),
  };
}
try {
  for (const c of reference.cases) {
    const entry = policy.metadata.actors[c.actorKey][c.index];
    check(
      JSON.stringify(entry.rows) === JSON.stringify(c.loaded.rows) &&
        entry.gearIdentity === c.gearIdentity,
      "Prepared gear lost/reordered original rows",
    );
    counts.authoredRowComparisons += entry.rows.length;
    if (c.loaded.resolver === null) {
      check(
        policy.lookupAuthoredEntry(c.actorKey, c.index, 1).status ===
          "null-gear-resolver",
        "Null gear resolver differs",
      );
      counts.nullResolvers++;
    } else {
      const keys = [
        ...new Set([...entry.rows.map((r) => r.key), 0, 1, 0xffffffff]),
      ];
      for (const key of keys) {
        const nativeResult = originalLookup(c.loaded.resolver, key),
          translated = policy.lookupAuthoredEntry(c.actorKey, c.index, key),
          first = entry.rows.find((r) => r.key === key);
        check(
          nativeResult.found === Boolean(first) &&
            nativeResult.value === (first?.value ?? 0) &&
            (first
              ? translated.referenceToken === nativeResult.value
              : translated.status === "key-absent"),
          "Original native/WASM/JS gear resource lookup differs",
        );
        check(
          Object.isFrozen(translated) &&
            !translated.liveUnitSelectionVerified &&
            !translated.referenceLinksFixed,
          "Authored gear result lost its immutable scope",
        );
        counts.immutableResults++;
        if (first?.value === 0) counts.nullMatches++;
        if (c.loaded.duplicateKeys.includes(key))
          counts.duplicateKeyComparisons++;
        results.push({
          actorKey: c.actorKey,
          index: c.index,
          key,
          ...nativeResult,
        });
      }
    }
    counts.gearEntries++;
  }
  for (const [actor, entries] of Object.entries(policy.metadata.actors))
    for (const index of [-128, -1, entries.length, 127]) {
      check(
        policy.lookupAuthoredEntry(actor, index, 1).status ===
          "native-selection-rejected",
        "Invalid gear index became a reset/default",
      );
      counts.invalidIndexRejections++;
    }
  const bundle = await Bun.build({
    entrypoints: [`${root}/latest-unit-gear-resources.mjs`],
    target: "browser",
    write: false,
  });
  check(bundle.success, "Browser gear resource module failed to bundle");
  await Bun.write(
    `${cache}/research/unit-gear-resources-comparison.json`,
    JSON.stringify(
      {
        schema: 1,
        kind: "unit-gear-resources-native-wasm-comparison",
        inputs,
        sources: Object.fromEntries(
          await Promise.all(
            [
              "latest-unit-gear-resources.mjs",
              "tools/inspect-unit-gear-resources.mjs",
            ].map(async (p) => [
              p,
              sha(await Bun.file(`${root}/${p}`).bytes()),
            ]),
          ),
        ),
        counts,
        results,
        mismatchCount: 0,
        scope: {
          originalFullTypedGearFieldsRead: true,
          originalSuppliedTableCopyExecuted: true,
          originalLookupExecutedInWasm: true,
          browserBundleBuilt: true,
          browserExecuted: false,
          liveUnitGearSelectionRecovered: false,
          liveResourceStackReconstructed: false,
          referenceLinksFixed: false,
          effectFactoryExecuted: false,
          mainViewerExpanded: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ counts, mismatchCount: 0 }));
} finally {
  native.close();
}
