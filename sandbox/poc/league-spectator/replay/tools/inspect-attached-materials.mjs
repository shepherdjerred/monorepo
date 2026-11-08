import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createLatestAttachedMaterials } from "../latest-attached-materials.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-attached-materials.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
async function raw(p) {
  const b = new Uint8Array(await Bun.file(p).arrayBuffer());
  inputs[p] = sha(b);
  return b;
}
async function json(p) {
  return JSON.parse(new TextDecoder().decode(await raw(p)));
}
function check(v, m) {
  if (!v) throw Error(m);
}
const path = `${cache}/research/attached-materials-native.json`,
  b = await raw(path),
  meta = JSON.parse(new TextDecoder().decode(b)),
  profile = await json(`${assets}/decoder-16.21-macos/profile.json`),
  attached = await json(`${assets}/latest-attached-mesh/package.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  quads = await json(`${assets}/decoder-16.21-macos/vfx-bound-quads.json`),
  shaders = await json(`${assets}/latest-shaders/package.json`),
  pairs = await json(`${cache}/research/latest-shaders/pairs.json`),
  shadow = await json(`${assets}/latest-attached-shadow-shaders/package.json`),
  shadowPairs = await json(
    `${cache}/research/latest-attached-shadow-shaders/pairs.json`,
  );
check(
  sha(image) === meta.decoderImageSha256 &&
    inputs[`${assets}/decoder-16.21-macos/vfx-bound-quads.json`] ===
      profile.vfxBoundQuadsSha256 &&
    pairs.shaderPackageSha256 ===
      inputs[`${assets}/latest-shaders/package.json`],
  "Material dependency changed",
);
check(
  shadow.baseShaderPackageSha256 ===
    inputs[`${assets}/latest-shaders/package.json`] &&
    shadow.nativeMaterialSha256 === sha(b) &&
    shadowPairs.shaderPackageSha256 ===
      inputs[`${assets}/latest-attached-shadow-shaders/package.json`],
  "Attached shadow supplement differs",
);
for (const [p, h] of Object.entries(meta.inputs))
  check(sha(await raw(p)) === h, `Material input changed: ${p}`);
for (const [name, h] of Object.entries(meta.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Native material source changed: ${name}`,
  );
for (const block of meta.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Native material instruction changed",
  );
for (const child of meta.childProcesses)
  check(sha(await raw(child.file)) === child.sha256, "Native worker changed");
const runtime = await createLatestAttachedMaterials(b, sha(b), profile),
  defaultMult = Buffer.from(
    quads.initializedGlobals.find((g) => g.rva === 0x253d218).bytesHex,
    "hex",
  ),
  vecHex = (v) => {
    const b = Buffer.alloc(16);
    v.forEach((x, i) => b.writeFloatLE(x, i * 4));
    return b.toString("hex");
  },
  programKey = (family, defs) =>
    `${family}|${JSON.stringify(defs.toSorted((a, b) => a.name.localeCompare(b.name)))}`,
  available = new Map(
    [
      { name: "latest-shaders", inventory: pairs },
      { name: "latest-attached-shadow-shaders", inventory: shadowPairs },
    ].flatMap(({ name, inventory }) =>
      inventory.programs.map((p, i) => [
        programKey(p.family, p.defines),
        { index: i, package: name, program: p },
      ]),
    ),
  ),
  selected = new Map(),
  unsupported = new Map();
const counts = {
  emitters: 0,
  descriptions: 0,
  vectorChecks: 0,
  sourceScalarChecks: 0,
  samplers: 0,
  mutationChecks: 0,
  rejectionChecks: 0,
};
for (const e of meta.emitters) {
  const ref = attached.entries[e.key];
  check(
    ref &&
      ref.effectId === e.effectId &&
      ref.emitterIndex === e.emitterIndex &&
      ref.postloadGraphSha256 === e.graphSha256 &&
      ref.sourceDefinitionSha256 === e.sourceDefinitionSha256,
    "Attached material identity differs",
  );
  const graphRaw = await raw(
      `${assets}/decoder-16.21-macos/${ref.postloadGraphFile}`,
    ),
    graph = JSON.parse(new TextDecoder().decode(graphRaw));
  check(sha(graphRaw) === e.graphSha256, "Attached material graph differs");
  const obj = Buffer.from(graph.objectHex, "hex"),
    heap = Buffer.from(graph.heapHex, "hex"),
    ptr = Number(obj.readBigUInt64LE(0x230));
  const mult = ptr
    ? heap.subarray(ptr - graph.heapStart, ptr - graph.heapStart + 0xa8)
    : defaultMult;
  check(mult.length >= 0xa8, "Attached mult object outside asset");
  for (const [name, columns, rows] of [
    ["TEXTURE_INFO", obj.readFloatLE(0x8c), obj.readFloatLE(0x90)],
    ["TEXTURE_INFO_2", mult.readFloatLE(0x10), mult.readFloatLE(0x14)],
  ]) {
    check(
      e.parameters.find((p) => p.name === name).bytesHex ===
        vecHex([
          columns,
          columns === 0 ? 0 : Math.fround(1 / columns),
          rows === 0 ? 0 : Math.fround(1 / rows),
          0,
        ]),
      "Attached texture atlas field differs",
    );
    counts.sourceScalarChecks++;
  }
  check(
    e.parameters.find((p) => p.name === "PARTICLE_DEPTH_PUSH_PULL").bytesHex ===
      vecHex([obj.readFloatLE(0x33c), 0, 0, 0]),
    "Attached depth push/pull differs",
  );
  counts.sourceScalarChecks++;
  for (const p of e.probes) {
    const d = runtime.describe(e.effectId, e.emitterIndex, p.input);
    check(
      d.vertex === p.selection.vertex &&
        d.pixel === p.selection.pixel &&
        d.renderStateHex === p.renderState.bytesHex &&
        d.programPrefixHex === p.renderState.programPrefixHex &&
        d.linkShaderFlag1a === p.selection.linkShaderFlag1a &&
        isDeepStrictEqual(d.defines, p.renderState.defines) &&
        isDeepStrictEqual(d.samplers, e.samplers),
      "Attached description differs from native",
    );
    for (const v of [
      ...e.parameters,
      ...e.erosionParameters,
      ...p.renderState.uniforms,
    ]) {
      check(
        vecHex([...d.parameters.get(v.name)]) === v.bytesHex,
        "Attached native float32 vector differs",
      );
      counts.vectorChecks++;
    }
    const alpha = p.renderState.uniforms.find(
      (v) => v.name === "AlphaTestReferenceValue",
    );
    if (alpha) {
      check(
        alpha.bytesHex === vecHex([Math.fround(obj[0x77] / 255), 0, 0, 0]),
        "Attached alpha reference differs",
      );
      counts.sourceScalarChecks++;
    }
    counts.samplers += d.samplers.length;
    counts.descriptions++;
    const family = [...shaders.pairs, ...shadow.pairs].find(
        (f) =>
          f.vertex === d.vertex.toLowerCase() &&
          f.pixel === d.pixel.toLowerCase(),
      ),
      key = family && programKey(family.name, d.defines),
      program = key && available.get(key);
    if (!program) {
      const k = JSON.stringify({
        vertex: d.vertex,
        pixel: d.pixel,
        defines: d.defines,
      });
      unsupported.set(k, (unsupported.get(k) || 0) + 1);
    } else selected.set(`${program.package}:${program.index}`, program);
  }
  const env = e.probes[0].input,
    d = runtime.describe(e.effectId, e.emitterIndex, env);
  d.defines.push({ name: "MUTATION", value: "1" });
  d.samplers[0].descriptorHex = "ffffffff00";
  d.parameters.values().next().value[0] = 1234;
  const after = runtime.describe(e.effectId, e.emitterIndex, env);
  check(
    !after.defines.some((v) => v.name === "MUTATION") &&
      after.samplers[0].descriptorHex !== "ffffffff00" &&
      vecHex([...after.parameters.values().next().value]) ===
        e.parameters[0].bytesHex,
    "Attached description leaked mutable state",
  );
  counts.mutationChecks++;
  counts.emitters++;
}
async function rejects(fn) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Unsupported attached material input accepted");
  counts.rejectionChecks++;
}
await rejects(() => createLatestAttachedMaterials(b, "0".repeat(64), profile));
await rejects(() =>
  createLatestAttachedMaterials(b, sha(b), {
    ...profile,
    clientVersion: "16.18.817.5716",
  }),
);
const first = meta.emitters[0],
  env = first.probes[0].input;
await rejects(() => runtime.describe("unknown", 0, env));
for (const patch of [
  { pass: 7 },
  { resourceMask: 8 },
  { featuresEnabled: 1 },
  { graphics34b: 0 },
  { resolvedResourceFlag95: 0 },
  { systemFogMode: 2 },
  { graphics29c: 3 },
  { extra: true },
])
  await rejects(() =>
    runtime.describe(first.effectId, first.emitterIndex, { ...env, ...patch }),
  );
const missing = { ...env };
delete missing.resolvedResourceFlag95;
await rejects(() =>
  runtime.describe(first.effectId, first.emitterIndex, missing),
);
await rejects(() =>
  runtime.describe(first.effectId, first.emitterIndex, {
    ...env,
    resourceMask: 7,
    pass: 6,
    graphics29c: 2,
    systemFogMode: 1,
  }),
);
const built = await Bun.build({
  entrypoints: [`${root}/latest-attached-materials.mjs`],
  target: "browser",
  external: ["three", "/assets/*"],
});
check(built.success, "Attached material browser-target build failed");
const output = {
  schema: 1,
  kind: "attached-material-component-comparison",
  nativeSha256: sha(b),
  inspectorSha256: sha(await raw(import.meta.path)),
  inputs,
  sourceSha256: sha(await raw(`${root}/latest-attached-materials.mjs`)),
  counts,
  selectedPrograms: [...selected.values()].map(
    ({ index, package: packageName, program: p }) => ({
      index,
      package: packageName,
      family: p.family,
      defines: p.defines,
      vertex: p.vertex,
      pixel: p.pixel,
    }),
  ),
  unsupportedPrograms: [...unsupported].map(([key, count]) => ({
    selection: JSON.parse(key),
    observations: count,
  })),
  scope: {
    ...meta.scope,
    browserCompatibleAdapterCompared: true,
    browserTargetBuild: true,
    browserRun: false,
    mainViewerIntegrated: false,
    shaderProgramsLinked: false,
    referencePixelsCompared: false,
  },
};
await Bun.write(
  `${cache}/research/attached-materials-comparison.json`,
  JSON.stringify(output, null, 2),
);
console.log(
  JSON.stringify({
    counts,
    selectedPrograms: selected.size,
    unsupportedPrograms: unsupported.size,
  }),
);
