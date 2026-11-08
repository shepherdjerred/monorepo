// Execute the original typed reference fixups in WASM over native-loaded maps.
// The local asset library is explicit input; globals/world creation are excluded.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeDecoder } from "../native-decoder.mjs";
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
  types = await read(`${cache}/research/effect-link-types-native.json`),
  manifest = await read(`${assets}/latest-effects/manifest.json`),
  vendor = `${assets}/vendor/unicorn_x86_candidate.mjs`,
  { default: factory } = await import(pathToFileURL(vendor).href),
  uc = await factory(),
  selected = process.argv[3],
  actors = Object.entries(manifest.actors).filter(
    ([key, actor]) =>
      actor.resourceResolverId !== null && (!selected || key === selected),
  ),
  results = [],
  counts = {
    actors: 0,
    linkedRows: 0,
    resolvedActors: 0,
    globalBoundaryActors: 0,
    rootPointersCompared: 0,
    nullReferencesCompared: 0,
    immutableLibrarySnapshots: 0,
  };
check(
  actors.length > 0 &&
    types.build === profile.clientVersion &&
    types.protocol === profile.protocolDigest &&
    types.decoderImageSha256 === sha(image),
  "Matching original type hierarchy required",
);
for (const [name, digest] of Object.entries(types.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Changed original reflection producer: ${name}`,
  );
for (const b of types.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original reflection instructions changed",
  );
for (const [actorKey] of actors) {
  const reference = await read(
    `${cache}/research/effect-links-native/actor-${actorKey.replaceAll("/", "-")}.json`,
  );
  check(
    reference.kind === "native-typed-effect-link-observation" &&
      reference.actorKey === actorKey &&
      reference.build === profile.clientVersion &&
      reference.protocol === profile.protocolDigest &&
      reference.decoderImageSha256 === sha(image) &&
      reference.scope.callerSuppliedLocalLibrary &&
      !reference.scope.globalAssetRegistryExecuted &&
      !reference.scope.worldFactoryExecuted,
    "Unsupported original typed link observation",
  );
  for (const [name, digest] of Object.entries(reference.sources))
    check(
      sha(await raw(`${root}/tools/${name}`)) === digest,
      `Changed original link producer: ${name}`,
    );
  for (const [path, digest] of Object.entries(reference.inputs))
    check(sha(await raw(path)) === digest, "Changed original typed link input");
  for (const b of reference.originalBlocks)
    check(
      sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
      "Original typed link instructions changed",
    );
  const native = new NativeDecoder(uc, profile, image, {
      captureWrites: false,
    }),
    e = native.engine,
    base = profile.imageBase,
    f = reference.fixups,
    pages = new Set(),
    snapshots = [];
  let active = false;
  try {
    function snapshot(address, hex, immutable = false) {
      const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
      check(
        bytes.length > 0 &&
          address >= 0x10000000 &&
          address + bytes.length <= 0x12000000,
        "Typed link snapshot outside owned arena",
      );
      for (
        let page = Math.floor(address / 4096) * 4096;
        page < address + bytes.length;
        page += 4096
      )
        if (page >= 0x10400000 && !pages.has(page)) {
          e.mem_map(page, 4096, uc.PROT_ALL);
          pages.add(page);
        }
      e.mem_write(address, bytes);
      if (immutable) snapshots.push({ address, bytes });
    }
    for (const type of types.types) {
      check(
        type.rva >= 0x1fef000 &&
          type.rva + 0x88 <= image.length &&
          type.bytesHex.length === 0x88 * 2,
        "Initialized reflection descriptor outside data image",
      );
      e.mem_write(
        base + type.rva,
        Uint8Array.from(Buffer.from(type.bytesHex, "hex")),
      );
    }
    snapshot(f.contextAddress, f.contextHex);
    snapshot(f.pendingAddress, f.pendingHex, true);
    snapshot(f.libraryAddress, f.libraryHex, true);
    snapshot(f.tableAddress, f.tableHex, true);
    snapshot(f.resolverAddress, f.resolverHex, true);
    snapshot(f.mapAddress, f.mapBeforeHex);
    // The admitted nonvirtual inheritance cast returns root addresses without
    // dereferencing root contents. Root bodies are copied for ownership/readback.
    for (const root of reference.loadedRoots)
      snapshot(root.object, root.objectHex, true);
    e.hook_add(
      uc.HOOK_CODE,
      () => {
        if (active) e.emu_stop();
      },
      null,
      base + 0x14bc000,
      base + 0x14bc000,
    );
    e.hook_add(
      uc.HOOK_BLOCK,
      (_e, address) => {
        const rva = Number(address) - base;
        check(
          active &&
            [
              [0x14bbf40, 0x14bc060],
              [0x14b62d0, 0x14b6400],
            ].some(([a, b]) => rva >= a && rva < b),
          "Typed fixups escaped original local lookup/cast code",
        );
      },
      null,
      base,
      base + image.length - 1,
    );
    e.context_restore(native.context);
    e.reg_write_i64(uc.X86_REG_RDI, BigInt(f.contextAddress));
    active = true;
    if (f.status === "requires-global-asset-library") {
      const stack = NativeDecoder.STACK + 0x200000 - 0x1000 + 8;
      native.u64(stack, 0x10009000);
      e.reg_write_i64(uc.X86_REG_RSP, BigInt(stack));
      e.emu_start(base + 0x14bbf40, base + 0x14bc000, 0, 1000000);
      check(
        Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + 0x14bc000,
        "Missing local asset did not reach global boundary",
      );
      counts.globalBoundaryActors++;
    } else {
      check(
        f.status === "typed-local-links-resolved",
        "Unknown typed link state",
      );
      native.call(base + 0x14bbf40);
      counts.resolvedActors++;
    }
    active = false;
    const after = native.read(f.mapAddress, f.mapBeforeHex.length / 2),
      contextAfter = native.read(
        f.contextAddress,
        f.contextAfterHex.length / 2,
      );
    check(
      Buffer.from(after).toString("hex") === f.mapAfterHex &&
        Buffer.from(contextAfter).toString("hex") === f.contextAfterHex,
      "Native/WASM typed reference fixup state differs",
    );
    if (f.status === "typed-local-links-resolved") {
      const roots = new Map(
        f.entries.map((entry) => [entry.identity, entry.object]),
      );
      for (const [i, row] of reference.resolverRows.entries()) {
        const value = Number(
          new DataView(after.buffer).getBigUint64(i * 16 + 8, true),
        );
        check(
          value === (row.value === 0 ? 0 : roots.get(row.value)),
          "Typed link did not select its authored root",
        );
        if (row.value === 0) counts.nullReferencesCompared++;
        else counts.rootPointersCompared++;
      }
    }
    for (const s of snapshots) {
      check(
        sha(native.read(s.address, s.bytes.length)) === sha(s.bytes),
        "Original link fixup mutated its input library/root",
      );
      counts.immutableLibrarySnapshots++;
    }
    counts.actors++;
    counts.linkedRows += reference.resolverRows.length;
    results.push({
      actorKey,
      status: f.status,
      roots: reference.loadedRoots.length,
      rows: reference.resolverRows.length,
      missingReferenceTokens: f.missingReferenceTokens,
    });
  } finally {
    native.close();
  }
}
const sources = {};
for (const name of ["tools/inspect-effect-links.mjs", "native-decoder.mjs"])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-typed-effect-link-comparison",
  inputs,
  sources,
  counts,
  results,
  mismatchCount: 0,
  scope: {
    partialActorSelection: Boolean(selected),
    originalTypedFixupAndInheritanceCast: true,
    callerSuppliedLocalLibrary: true,
    globalAssetRegistryExecuted: false,
    unitResourcePrecedenceVerified: false,
    worldFactoryExecuted: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-links-${selected ? "partial-" : ""}comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, results }));
