// Inspect retained original/translated pixels and publish the scoped evidence.
// Nonzero differences remain results, never tolerance-based success claims.
import { basename, resolve } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-shader-pixels.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  shadowRoot = `${assets}/latest-shadow-shaders`;
const read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer());
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const requireThat = (condition, message) => {
  if (!condition) throw Error(message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const load = async (path) => {
  const bytes = await read(path);
  return { bytes, data: JSON.parse(new TextDecoder().decode(bytes)) };
};
const base = await load(`${assets}/latest-shaders/package.json`),
  shadow = await load(`${shadowRoot}/package.json`),
  material = await load(`${cache}/research/vfx-materials-comparison.json`),
  pairs = await load(`${cache}/research/latest-shadow-shaders/pairs.json`),
  angle = await load(`${cache}/research/latest-shadow-shaders/angle.json`),
  pixels = await load(`${assets}/evidence/latest-shader-pixels.json`);
const s = shadow.data,
  p = pixels.data;
requireThat(
  s.build === "16.21.829.8620" &&
    s.kind === "installed-particle-shader-translations" &&
    s.baseShaderPackageSha256 === sha(base.bytes) &&
    s.nativeMaterialInspectionSha256 === sha(material.bytes) &&
    material.data.shaderPackageSha256 === sha(base.bytes) &&
    material.data.scope.mismatchCount === 0 &&
    same(s.counts, {
      pairs: 1,
      stages: 2,
      permutations: 4,
      records: 4,
      uniqueTranslations: 4,
      failed: 0,
    }) &&
    s.compiler.preparationSha256 ===
      sha(await read(`${root}/tools/prepare-shadow-shaders.mjs`)),
  "Shadow package or native selection evidence changed",
);
for (const [name, expected] of Object.entries(base.data.compiler))
  if (name !== "preparationSha256")
    requireThat(
      s.compiler[name] === expected,
      `Shadow compiler differs: ${name}`,
    );
const known = new Set(
  [...base.data.stages, ...s.stages].map((stage) => stage.file),
);
const missing = material.data.selectedPairs
  .flatMap((pair) => pair.files)
  .filter((file) => !known.has(file));
requireThat(
  missing.length === 0 &&
    material.data.missingPreparedShaders.length === 2 &&
    material.data.missingPreparedShaders.every((entry) =>
      s.stages.some((stage) => stage.file === entry.file),
    ),
  "Combined native shader-name closure is incomplete",
);
requireThat(
  pairs.data.shaderPackageSha256 === sha(shadow.bytes) &&
    pairs.data.preparerSha256 ===
      sha(await read(`${root}/tools/prepare-shader-pairs.mjs`)) &&
    pairs.data.programs.length === 2 &&
    angle.data.shaderPackageSha256 === sha(shadow.bytes) &&
    angle.data.pairInventorySha256 === sha(pairs.bytes) &&
    angle.data.observerSha256 ===
      sha(await read(`${root}/tools/observe-shader-angle.py`)) &&
    same(angle.data.counts, {
      compiled: 4,
      compileFailures: 0,
      linked: 2,
      uniqueLinks: 2,
      unobservedPrograms: 0,
      linkFailures: 0,
    }) &&
    angle.data.context.webglCompatibility &&
    same(angle.data.selectedFamilies, ["shadowQuad"]) &&
    angle.data.stages.every((stage) => stage.success) &&
    angle.data.programs.every((program) => program.success),
  "Incomplete shadow compile/link observation",
);
const paths = new Map();
const expose = async (path, bytes) => {
  await Bun.write(`${assets}/${path}`, bytes);
  paths.set(`/assets/${path}`, sha(bytes));
};
paths.set("/assets/latest-shadow-shaders/package.json", sha(shadow.bytes));
paths.set(
  "/assets/latest-shadow-shaders/HEXShade-LICENSE.txt",
  sha(await read(`${shadowRoot}/HEXShade-LICENSE.txt`)),
);
for (const ref of s.translations) {
  const translation = await load(`${shadowRoot}/${ref.file}`),
    dxbc = await read(`${shadowRoot}/${ref.dxbc}`);
  const observed = angle.data.stages.find(
    (stage) => stage.key === `${ref.stage}:${ref.dxbcSha256}`,
  );
  requireThat(
    sha(translation.bytes) === ref.sha256 &&
      sha(dxbc) === ref.dxbcSha256 &&
      observed?.sha256 === ref.sha256 &&
      translation.data.adapter?.version === 1 &&
      translation.data.adapter.samplerNames === "original DXBC RDEF" &&
      translation.data.adapter.shaderCodeRewritten === false,
    "Shadow shader bytes/metadata changed",
  );
  paths.set(`/assets/latest-shadow-shaders/${ref.file}`, ref.sha256);
  paths.set(`/assets/latest-shadow-shaders/${ref.dxbc}`, ref.dxbcSha256);
}
for (const [path, expected] of Object.entries(p.sources))
  requireThat(
    sha(await read(path)) === expected,
    `Stale pixel source: ${path}`,
  );
for (const [name, expected] of Object.entries({
  "observe-shader-pixels.py": p.observerSha256,
  "render-particle-shader.py": p.drawAdapterSha256,
  "shader-oracle.cpp": p.oracleBuild.sourceSha256,
  "build-shader-oracle.ps1": p.oracleBuild.builderSha256,
}))
  requireThat(
    sha(await read(`${root}/tools/${name}`)) === expected,
    `Stale oracle source: ${name}`,
  );
requireThat(
  p.kind === "original-dxbc-vs-translated-glsl-pixels" &&
    p.build === s.build &&
    p.scope.tolerance === 0 &&
    [
      "edgePixelsExcluded",
      "alphaExcluded",
      "browserRun",
      "leagueRun",
      "originalSceneInputsRecovered",
      "sceneShadowsRendered",
      "mainViewerIntegrated",
      "leagueReferenceCompared",
    ].every((key) => p.scope[key] === false) &&
    p.observations.length === 18 &&
    same(p.context, angle.data.context) &&
    same(p.angleLibraries, angle.data.libraries),
  "Pixel observation scope or graphics backend changed",
);
for (const [name, dependency] of Object.entries(p.angleNativeDependencies))
  requireThat(
    sha(await read(dependency.path)) === dependency.sha256 &&
      dependency.sha256 === p.oracleBuild.libraries[name],
    `Native graphics dependency differs: ${name}`,
  );
const buckets = Object.fromEntries(
  ["color", "unblendedColor", "shadow"].map((key) => [
    key,
    { cases: 0, exactCases: 0, changedPixels: 0, maximumAbsoluteRgbaError: 0 },
  ]),
);
const seen = new Set(),
  retained = [];
let reflectedMembers = 0;
for (const o of p.observations) {
  const key = o.shadow ? "shadow" : o.unblended ? "unblendedColor" : "color";
  const identity = `${key}:${o.effectId}:${o.emitterIndex}:${o.time}`;
  requireThat(
    !seen.has(identity) && !(o.shadow && o.unblended),
    "Duplicate or invalid oracle sample",
  );
  seen.add(identity);
  const original = await read(o.originalPixelFile),
    translated = await read(o.translatedPixelFile),
    request = await read(o.requestFile);
  requireThat(
    original.length === 512 * 512 * 4 &&
      translated.length === original.length &&
      sha(original) === o.originalRgbaSha256 &&
      sha(translated) === o.translatedRgbaSha256 &&
      sha(request) === o.requestSha256 &&
      Buffer.from(request.subarray(0, 8)).toString("ascii") === "SCDXBC01" &&
      o.nativeReflection.backend === "D3D11 WARP" &&
      o.nativeReflection.width === 512 &&
      o.nativeReflection.height === 512 &&
      o.nativeReflection.rowOrder === "top-down RGBA8" &&
      o.nativeReflection.reflectedMembers > 0,
    "Original/translated readback or native reflection changed",
  );
  const maximum = [0, 0, 0, 0],
    details = [];
  let changedPixels = 0,
    absoluteSum = 0;
  for (let at = 0; at < original.length; at += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(original[at + channel] - translated[at + channel]);
      maximum[channel] = Math.max(maximum[channel], delta);
      absoluteSum += delta;
      changed ||= delta !== 0;
    }
    if (changed) {
      changedPixels++;
      if (details.length < 100)
        details.push({
          x: (at / 4) % 512,
          y: Math.floor(at / 4 / 512),
          original: [...original.subarray(at, at + 4)],
          translated: [...translated.subarray(at, at + 4)],
        });
    }
  }
  requireThat(
    changedPixels === o.changedPixels &&
      same(maximum, o.maximumPerChannelError) &&
      Math.max(...maximum) === o.maximumAbsoluteRgbaError &&
      absoluteSum / original.length === o.meanAbsoluteRgbaError &&
      same(details, o.changedPixelDetails),
    "Independent zero-tolerance RGBA comparison disagrees",
  );
  const bucket = buckets[key];
  bucket.cases++;
  bucket.exactCases += Number(changedPixels === 0);
  bucket.changedPixels += changedPixels;
  bucket.maximumAbsoluteRgbaError = Math.max(
    bucket.maximumAbsoluteRgbaError,
    ...maximum,
  );
  reflectedMembers += o.nativeReflection.reflectedMembers;
  const urls = [];
  for (const [file, bytes] of [
    [o.originalPixelFile, original],
    [o.translatedPixelFile, translated],
  ]) {
    const path = `evidence/shader-pixels/${basename(file)}`;
    await expose(path, bytes);
    urls.push(`/assets/${path}`);
  }
  retained.push({
    identity,
    original: urls[0],
    translated: urls[1],
    originalSha256: o.originalRgbaSha256,
    translatedSha256: o.translatedRgbaSha256,
  });
}
const computed = {
  cases: p.observations.length,
  colorCases: buckets.color.cases,
  shadowCases: buckets.shadow.cases,
  unblendedColorCases: buckets.unblendedColor.cases,
  nativeReflectionMemberChecks: reflectedMembers,
  exactCases: Object.values(buckets).reduce((sum, b) => sum + b.exactCases, 0),
  changedPixels: Object.values(buckets).reduce(
    (sum, b) => sum + b.changedPixels,
    0,
  ),
  maximumAbsoluteRgbaError: Math.max(
    ...Object.values(buckets).map((b) => b.maximumAbsoluteRgbaError),
  ),
};
requireThat(
  same(computed, p.counts) &&
    Object.values(buckets).every((b) => b.cases === 6),
  "Pixel summary disagrees with retained readbacks",
);
const png = await read(`${assets}/evidence/latest-shader-pixels.png`);
requireThat(sha(png) === p.imageSha256, "Pixel comparison figure changed");
await expose("evidence/latest-shadow-shader-pairs.json", pairs.bytes);
await expose("evidence/latest-shadow-shader-angle.json", angle.bytes);
paths.set("/assets/evidence/latest-shader-pixels.png", sha(png));
paths.set("/assets/evidence/latest-shader-pixels.json", sha(pixels.bytes));
const inspection = {
  schema: 1,
  kind: "shader-pixel-inspection",
  build: s.build,
  inspectorSha256: sha(await read(import.meta.path)),
  pixelObservationSha256: sha(pixels.bytes),
  baseShaderPackageSha256: sha(base.bytes),
  shadowShaderPackageSha256: sha(shadow.bytes),
  nativeMaterialInspectionSha256: sha(material.bytes),
  combinedMissingShaderNames: [],
  counts: computed,
  buckets,
  retained,
  scope: {
    zeroTolerance: true,
    allRgbaChannels: true,
    allPixels: true,
    browserRun: false,
    mainViewerIntegrated: false,
    sceneShadowsRendered: false,
    leagueReferenceCompared: false,
  },
};
// Independently recompare native stream-output / GL transform-feedback floats.
// Native register packing is recorded separately from semantic components.
const vertices = await load(`${cache}/research/shader-vertices.json`),
  v = vertices.data;
requireThat(
  v.kind === "original-dxbc-vs-translated-glsl-vertices" &&
    v.build === s.build &&
    v.observerSha256 ===
      sha(await read(`${root}/tools/observe-shader-vertices.py`)) &&
    v.drawAdapterSha256 === p.drawAdapterSha256 &&
    same(v.oracleBuild, p.oracleBuild) &&
    same(v.context, p.context) &&
    v.observations.length === 12 &&
    v.scope.tolerance === 0 &&
    v.scope.clipZNormalization === "float32(2 * originalZ) - originalW" &&
    v.scope.nativeDefinedComponentsOnly &&
    v.scope.pointDrawEachInputOnce &&
    [
      "shaderSourceRewritten",
      "browserRun",
      "leagueRun",
      "pixelCauseEstablished",
      "hardwareEquivalence",
      "mainViewerIntegrated",
    ].every((key) => v.scope[key] === false),
  "Vertex capture scope or provenance changed",
);
for (const [path, expected] of Object.entries(v.sources))
  requireThat(
    sha(await read(path)) === expected,
    `Stale vertex source: ${path}`,
  );
const vertexCounts = {
    cases: 0,
    vertices: 0,
    lanes: 0,
    changedLanes: 0,
    exactCases: 0,
    rasterReadbackChanges: 0,
  },
  vertexFiles = [],
  vertexIdentities = new Set();
const floatBits = (number) => {
  const storage = new DataView(new ArrayBuffer(4));
  storage.setFloat32(0, number, true);
  return storage.getUint32(0, true);
};
for (const o of v.observations) {
  const identity = `${o.shadow}:${o.effectId}:${o.emitterIndex}:${o.time}`;
  requireThat(
    !vertexIdentities.has(identity),
    "Duplicate vertex capture sample",
  );
  vertexIdentities.add(identity);
  const baseline = p.observations.find(
    (b) =>
      !b.unblended &&
      b.shadow === o.shadow &&
      b.effectId === o.effectId &&
      b.emitterIndex === o.emitterIndex &&
      b.time === o.time,
  );
  requireThat(
    baseline?.requestSha256 === o.requestSha256,
    "Vertex capture differs from pixel input",
  );
  const original = await read(o.originalFile),
    translated = await read(o.translatedFile);
  requireThat(
    sha(original) === o.originalSha256 &&
      sha(translated) === o.translatedSha256 &&
      original.length === o.vertices * o.originalStride &&
      translated.length === o.vertices * o.outputs.length * 16 &&
      same(
        o.nativeSignature,
        o.outputs.map(
          ({
            semantic,
            index,
            firstComponent,
            registerFirstComponent,
            components,
            offset,
          }) => ({
            semantic,
            index,
            firstComponent,
            registerFirstComponent,
            components,
            offset,
          }),
        ),
      ),
    "Vertex capture bytes/signature changed",
  );
  const nativeView = new DataView(
      original.buffer,
      original.byteOffset,
      original.byteLength,
    ),
    glView = new DataView(
      translated.buffer,
      translated.byteOffset,
      translated.byteLength,
    );
  let changedTotal = 0;
  for (let index = 0; index < o.outputs.length; index++) {
    const output = o.outputs[index],
      differences = [];
    let maximum = 0;
    requireThat(
      output.firstComponent === 0 &&
        output.components > 0 &&
        output.components <= 4 &&
        output.lanes === o.vertices * output.components,
      "Unsupported vertex output component range",
    );
    for (let vertex = 0; vertex < o.vertices; vertex++) {
      for (let component = 0; component < output.components; component++) {
        const offset =
          vertex * o.originalStride + output.offset + component * 4;
        let expected = nativeView.getFloat32(offset, true);
        if (output.glslName === "gl_Position" && component === 2)
          expected = Math.fround(
            Math.fround(2 * expected) -
              nativeView.getFloat32(
                vertex * o.originalStride + output.offset + 12,
                true,
              ),
          );
        const glOffset =
            (vertex * o.outputs.length + index) * 16 + component * 4,
          actual = glView.getFloat32(glOffset, true);
        requireThat(
          Number.isFinite(expected) && Number.isFinite(actual),
          "Nonfinite captured vertex output",
        );
        maximum = Math.max(maximum, Math.abs(expected - actual));
        if (floatBits(expected) !== glView.getUint32(glOffset, true))
          differences.push({
            vertex,
            component,
            originalNormalized: expected,
            translated: actual,
            originalBits: floatBits(expected).toString(16).padStart(8, "0"),
            translatedBits: glView
              .getUint32(glOffset, true)
              .toString(16)
              .padStart(8, "0"),
          });
      }
    }
    requireThat(
      output.changedLanes === differences.length &&
        same(output.differences, differences) &&
        output.maximumAbsoluteError === maximum,
      "Independent vertex comparison disagrees",
    );
    vertexCounts.lanes += output.lanes;
    changedTotal += differences.length;
  }
  requireThat(
    o.changedLanes === changedTotal,
    "Vertex sample summary disagrees",
  );
  vertexCounts.cases++;
  vertexCounts.vertices += o.vertices;
  vertexCounts.changedLanes += changedTotal;
  vertexCounts.exactCases += Number(changedTotal === 0);
  vertexCounts.rasterReadbackChanges += Number(
    !o.rasterReadbackReproducesBaseline,
  );
  const urls = [];
  for (const [file, bytes] of [
    [o.originalFile, original],
    [o.translatedFile, translated],
  ]) {
    const path = `evidence/shader-vertices/${basename(file)}`;
    await expose(path, bytes);
    urls.push(`/assets/${path}`);
  }
  vertexFiles.push({
    identity,
    original: urls[0],
    translated: urls[1],
    originalSha256: o.originalSha256,
    translatedSha256: o.translatedSha256,
  });
}
requireThat(
  same(vertexCounts, v.counts),
  "Vertex capture summary disagrees with raw floats",
);
inspection.vertexCounts = vertexCounts;
inspection.vertexFiles = vertexFiles;
inspection.vertexObservationSha256 = sha(vertices.bytes);
await expose("evidence/latest-shader-vertices.json", vertices.bytes);
await expose(
  "evidence/shader-pixel-inspection.json",
  JSON.stringify(inspection, null, 2),
);
for (const path of ["/README.md", "/AV-FIDELITY-MAP.md"])
  paths.set(path, sha(await read(`${root}${path}`)));
const results = [];
for (const baseUrl of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  for (const [path, expected] of paths) {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.arrayBuffer();
    requireThat(
      response.status === 200 && sha(data) === expected,
      `Pixel publication mismatch: ${baseUrl}${path}`,
    );
    results.push({
      base: baseUrl,
      path,
      status: response.status,
      sha256: expected,
    });
  }
}
await Bun.write(
  `${cache}/research/shader-pixels-publication.json`,
  JSON.stringify({ ...inspection, results }, null, 2),
);
console.log(
  JSON.stringify({
    matchedFiles: results.length,
    counts: computed,
    buckets,
    vertexCounts,
    combinedMissingShaderNames: [],
  }),
);
