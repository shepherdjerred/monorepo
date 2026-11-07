// Original native/WASM pass selection, portable JS selection and actual captured
// GPU bytes. Synthetic controls exercise alias order; they are never published
// as authored material rows or used as missing scene resources.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { NativeDecoder } from "../native-decoder.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import {
  createLatestNativeParentMaterials,
  lookupNativeMaterialPass,
  NATIVE_PARENT_MATERIALS_SHA,
} from "../latest-native-parent-materials.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  directory = `${assets}/latest-parent-native-materials`,
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
  unhex = (h) => new Uint8Array(Buffer.from(h, "hex")),
  observationPath = `${cache}/research/parent-native-materials.json`,
  observation = await read(observationPath),
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  packageBytes = await raw(`${directory}/package.json`),
  api = await createLatestNativeParentMaterials({
    profile,
    packageBytes,
    effectsManifestBytes: await raw(`${assets}/latest-effects/manifest.json`),
  }),
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
  e = native.engine;
check(
  observation.kind === "complete-native-parent-material-observations" &&
    !observation.scope.partialSelection &&
    observation.counts.roots === observation.counts.capturedRoots &&
    observation.decoderImageSha256 === sha(image) &&
    api.metadata.nativeObservationSha256 === inputs[observationPath],
  "Complete exact original material observation required",
);
for (const [name, digest] of Object.entries(observation.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native material observer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(observation.inputs))
  check(
    sha(await raw(path)) === digest,
    `Native material observer input changed: ${path}`,
  );
for (const block of observation.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Native material source code differs",
  );
e.mem_map(0x10400000, 0x1c00000, uc.PROT_ALL);
e.mem_protect(
  profile.imageBase + 0x9000,
  0x1fef000 - 0x9000,
  uc.PROT_READ | uc.PROT_EXEC,
);
let active = false;
e.hook_add(
  uc.HOOK_BLOCK,
  (_e, address, size) => {
    const at = Number(address) - profile.imageBase;
    check(
      active && at >= 0x17c2100 && at + size <= 0x17c2190,
      "Material lookup escaped original read-only function",
    );
  },
  null,
  profile.imageBase,
  profile.imageBase + image.length - 1,
);
function u32(bytes, at, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    at,
    value,
    true,
  );
}
function u64(bytes, at, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(
    at,
    BigInt(value),
    true,
  );
}
function loadSnapshot(material, header, rows, aliases) {
  const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength,
    ),
    table = Number(view.getBigUint64(0, true)),
    aliasTable = Number(view.getBigUint64(0x40, true));
  e.mem_protect(0x10400000, 0x1c00000, uc.PROT_READ | uc.PROT_WRITE);
  const segments = [
    [material, header],
    [table, rows],
    ...(aliases.length ? [[aliasTable, aliases]] : []),
  ];
  for (const [at, bytes] of segments) {
    check(
      !bytes.length || (at >= 0x10400000 && at + bytes.length <= 0x12000000),
      "Material snapshot exceeds owned arena",
    );
    if (bytes.length) e.mem_write(at, bytes);
  }
  e.mem_protect(0x10400000, 0x1c00000, uc.PROT_READ);
  return () => {
    for (const [at, bytes] of segments)
      if (bytes.length)
        check(
          sha(native.read(at, bytes.length)) === sha(bytes),
          "Original material lookup mutated supplied snapshot",
        );
  };
}
function lookup(material, hash) {
  e.context_restore(native.context);
  e.reg_write_i64(uc.X86_REG_RDI, BigInt(material));
  e.reg_write_i64(uc.X86_REG_RSI, BigInt(hash));
  active = true;
  try {
    native.call(profile.imageBase + 0x17c2100);
    return Number(e.reg_read_i64(uc.X86_REG_RAX));
  } finally {
    active = false;
  }
}
const counts = {
    roots: 0,
    actors: 0,
    authoredLookups: 0,
    variants: 0,
    textures: 0,
    texturePlanes: 0,
    shaderStages: 0,
    immutableSnapshots: 0,
    controlledLookups: 0,
    cycleRejections: 0,
    exportIsolationChecks: 0,
  },
  checks = [];
try {
  for (const c of observation.cases) {
    for (const actor of c.passes.actors) {
      const header = unhex(actor.headerHex),
        rows = unhex(actor.rows.map((r) => r.bytesHex).join("")),
        aliases = new Uint8Array(actor.aliases.length * 8);
      actor.aliases.forEach((a, i) => {
        u32(aliases, i * 8, a.sourceHash);
        u32(aliases, i * 8 + 4, a.queryHash);
      });
      const immutable = loadSnapshot(actor.material, header, rows, aliases);
      for (const query of actor.lookups) {
        const actual = lookup(actor.material, query.hash),
          row =
            query.selectedRow === null
              ? undefined
              : actor.rows[query.selectedRow],
          selected = api.resolve(c.effectId, actor.emitterIndex, query.hash, 0);
        check(
          actual === (row?.address ?? 0),
          "Original native/WASM material lookup differs",
        );
        check(
          row
            ? selected.status === "prepared-native-parent-material" &&
                selected.selectedPassHash === row.hash
            : selected.status === "unavailable-native-material-pass",
          "Native/JS material pass selection differs",
        );
        checks.push({
          effectId: c.effectId,
          emitterIndex: actor.emitterIndex,
          queryHash: query.hash,
          selectedRow: query.selectedRow,
        });
        counts.authoredLookups++;
      }
      immutable();
      counts.immutableSnapshots++;
      counts.actors++;
      for (const row of actor.rows)
        for (const variant of row.variants) {
          const selected = api.resolve(
              c.effectId,
              actor.emitterIndex,
              row.hash,
              variant.index,
            ).variant,
            pipeline = c.pipelines[variant.nativePipeline],
            binding = c.bindings[variant.nativeBinding],
            program = c.programs[variant.nativeProgram];
          check(
            selected.pipeline.descriptorHex === pipeline.descriptorHex &&
              isDeepStrictEqual(selected.pipeline.state, pipeline.state),
            "Portable material pipeline differs from original GPU-queried state",
          );
          for (const stage of ["vertex", "pixel"]) {
            const compiled = Object.values(c.shaders).find(
              (s) => s.glHandle === program[stage],
            );
            check(
              selected.shaders[stage].sha256 === compiled.translation.sha256,
              "Portable material selected another native shader",
            );
          }
          check(
            isDeepStrictEqual(
              selected.constantBuffers.map((b) => b.bytesHex),
              binding.uniformBuffers.map((b) => b.bytesHex),
            ) &&
              isDeepStrictEqual(selected.requiredScene, {
                blocks: binding.requiredSceneBlocks,
                textures: binding.requiredSceneTextures,
                dataBuffers: binding.requiredSceneDataBuffers,
              }),
            "Portable material constants/scene requirements differ",
          );
          for (let i = 0; i < selected.textures.length; i++) {
            const t = selected.textures[i],
              original = binding.textures[i],
              source = c.textures[original.nativeTexture];
            check(
              isDeepStrictEqual(
                api.metadata.textures[t.texture].levels,
                source.preparedLevels,
              ) &&
                t.sampler.descriptorHex === original.sampler.descriptorHex &&
                isDeepStrictEqual(
                  t.sampler.parameters,
                  original.sampler.queriedParameters,
                ),
              "Portable material texture/sampler differs from actual native GPU resource",
            );
          }
          counts.variants++;
        }
    }
    counts.roots++;
  }
  // Deliberately conflicting rows and aliases test original first-match and
  // alias direction. These supplied controls are not authored game resources.
  const controls = [
    {
      rows: [{ hash: 11 }, { hash: 11 }, { hash: 22 }],
      aliases: [],
      queries: [11, 22, 33],
    },
    {
      rows: [{ hash: 11 }, { hash: 22 }],
      aliases: [
        { sourceHash: 11, queryHash: 33 },
        { sourceHash: 22, queryHash: 33 },
      ],
      queries: [11, 33, 44],
    },
    {
      rows: [{ hash: 11 }, { hash: 33 }],
      aliases: [
        { sourceHash: 11, queryHash: 22 },
        { sourceHash: 22, queryHash: 44 },
        { sourceHash: 11, queryHash: 33 },
      ],
      queries: [22, 33, 44, 55],
    },
    {
      rows: [],
      aliases: [{ sourceHash: 11, queryHash: 22 }],
      queries: [11, 22],
    },
  ];
  for (const control of controls) {
    const address = 0x10400000,
      table = 0x10401000,
      aliasTable = 0x10402000,
      header = new Uint8Array(0x90),
      rows = new Uint8Array(control.rows.length * 32),
      aliases = new Uint8Array(control.aliases.length * 8);
    u64(header, 0, table);
    u32(header, 8, control.rows.length);
    u32(header, 12, control.rows.length);
    u64(header, 0x40, aliasTable);
    u32(header, 0x48, control.aliases.length);
    u32(header, 0x4c, control.aliases.length);
    control.rows.forEach((r, i) => u32(rows, i * 32 + 8, r.hash));
    control.aliases.forEach((a, i) => {
      u32(aliases, i * 8, a.sourceHash);
      u32(aliases, i * 8 + 4, a.queryHash);
    });
    const immutable = loadSnapshot(address, header, rows, aliases);
    for (const hash of control.queries) {
      const selected = lookupNativeMaterialPass(
          control.rows,
          control.aliases,
          hash,
        ),
        index = control.rows.indexOf(selected),
        actual = lookup(address, hash);
      check(
        actual === (index < 0 ? 0 : table + index * 32),
        "Original WASM/JS controlled material alias lookup differs",
      );
      counts.controlledLookups++;
    }
    immutable();
    counts.immutableSnapshots++;
  }
  let cycleRejected = false;
  try {
    lookupNativeMaterialPass(
      [],
      [
        { sourceHash: 11, queryHash: 22 },
        { sourceHash: 22, queryHash: 11 },
      ],
      11,
    );
  } catch (error) {
    cycleRejected = error.message === "Cyclic native material pass aliases";
  }
  check(cycleRejected, "Cyclic material aliases were not explicitly rejected");
  counts.cycleRejections++;
} finally {
  native.close();
}
for (const [id, ref] of Object.entries(api.metadata.textures)) {
  const first = await api.loadTexture(id, (name) =>
    raw(`${directory}/${name}`),
  );
  for (const level of first.levels) counts.texturePlanes += level.length;
  first.levels[0][0][0] ^= 255;
  const repeated = await api.loadTexture(id, (name) =>
    raw(`${directory}/${name}`),
  );
  check(
    sha(repeated.levels[0][0]) === ref.levels[0][0].sha256,
    "Exported material texture bytes alias stored resource data",
  );
  counts.exportIsolationChecks++;
  counts.textures++;
}
for (const id of Object.keys(api.metadata.shaderStages)) {
  check(
    Object.isFrozen(
      await api.loadShader(id, (name) =>
        raw(`${assets}/latest-shaders/${name}`),
      ),
    ),
    "Material shader metadata remains mutable",
  );
  counts.shaderStages++;
}
check(
  Object.isFrozen(api.metadata.roots) && Object.isFrozen(api.metadata.textures),
  "Material package metadata remains mutable",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-native-parent-materials.mjs`],
  target: "browser",
  write: false,
});
check(build.success, "Native parent material browser bundle failed");
const sources = {};
for (const name of [
  "latest-native-parent-materials.mjs",
  "latest-unicorn-bulk.mjs",
  "native-decoder.mjs",
  "tools/prepare-parent-native-materials.mjs",
  "tools/inspect-parent-native-materials.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-portable-parent-material-comparison",
  build: observation.build,
  protocol: observation.protocol,
  observationSha256: inputs[observationPath],
  packageSha256: NATIVE_PARENT_MATERIALS_SHA,
  inputs,
  sources,
  counts,
  checks,
  mismatchCount: 0,
  scope: {
    originalPassLookupWasmExecuted: true,
    authoredNativeWasmJavascriptCompared: true,
    syntheticAliasControls: true,
    controlledNativePythonExecution: false,
    readOnlySnapshotsCompared: true,
    nativeGpuTextureConstantsAndStateCompared: true,
    actualShaderSelectionsCompared: true,
    browserBundleBuilt: true,
    sceneResourcesProvided: false,
    perFrameUpdatesPrepared: false,
    gpuDrawSubmitted: false,
    mainViewerEnabled: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-native-materials-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
