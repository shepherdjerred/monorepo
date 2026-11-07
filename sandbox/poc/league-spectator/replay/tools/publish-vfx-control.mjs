// Publish the checked reversible control component and its controlled evidence.
// This does not connect replay teardown events or change the main renderer.
import { resolve, dirname } from "node:path";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-control.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer());
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await read(path)));
const requireThat = (condition, message) => {
  if (!condition) throw Error(message);
};
const packagePath = `${assets}/latest-vfx-control/package.json`,
  nativePath = `${cache}/research/vfx-control-native.json`,
  comparisonPath = `${cache}/research/vfx-control-comparison.json`,
  visualPath = `${assets}/evidence/latest-vfx-control.json`;
const prepared = await json(packagePath),
  native = await json(nativePath),
  comparison = await json(comparisonPath),
  visual = await json(visualPath),
  profile = await json(`${decoder}/profile.json`),
  bound = await json(`${decoder}/vfx-bound-quads.json`),
  image = await read(`${decoder}/image.bin`);
requireThat(
  prepared.kind === "native-emitter-birth-suppression" &&
    prepared.build === "16.21.829.8620" &&
    prepared.protocol === "20e09df23c66b85e" &&
    prepared.decoderImageSha256 === sha(image) &&
    prepared.quadPackageSha256 === profile.vfxBoundQuadsSha256 &&
    profile.vfxBoundQuadsSha256 ===
      sha(await read(`${decoder}/vfx-bound-quads.json`)) &&
    native.packageSha256 === sha(await read(packagePath)) &&
    comparison.packageSha256 === native.packageSha256 &&
    comparison.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    visual.nativeEvidenceSha256 === comparison.nativeEvidenceSha256 &&
    visual.comparisonSha256 === sha(await read(comparisonPath)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-vfx-control.png`)),
  "Emission-control package or evidence has changed",
);
for (const record of [prepared, native, comparison, visual])
  requireThat(
    record.build === prepared.build &&
      !record.scope.systemRetirement &&
      !record.scope.replayEventMapping &&
      !record.scope.mainViewerIntegrated,
    "Emission-control evidence exceeds its admitted scope",
  );
for (const sources of [prepared.compilerSources, native.sources])
  for (const [name, expected] of Object.entries(sources))
    requireThat(
      sha(await read(`${root}/tools/${name}`)) === expected,
      `Stale native source: ${name}`,
    );
for (const [name, expected] of Object.entries(comparison.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === expected,
    `Stale WASM source: ${name}`,
  );
for (const record of [native, comparison])
  for (const [path, expected] of Object.entries(record.inputs))
    requireThat(
      sha(await read(path)) === expected,
      `Stale observation input: ${path}`,
    );
requireThat(
  comparison.inspectorSha256 ===
    sha(await read(`${root}/tools/inspect-vfx-control.mjs`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-vfx-control.py`)),
  "Emission-control inspector or visual source changed",
);
for (const block of prepared.sourceBlocks)
  requireThat(
    sha(image.subarray(block.startRva, block.endRva)) === block.sha256,
    "Original control code changed",
  );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Observed original code changed",
  );

const flags = new Map();
for (const probe of native.flags) {
  const { initial, suspended, result } = probe;
  requireThat(
    Number.isInteger(initial) &&
      initial >= 0 &&
      initial <= 255 &&
      typeof suspended === "boolean" &&
      result.before === initial &&
      result.after === ((initial & ~2) | (Number(suspended) << 1)) &&
      result.objectValue === Number(suspended) &&
      result.objectDirty === 1,
    "Native control truth table differs",
  );
  const key = `${initial}:${suspended}`;
  flags.set(key, (flags.get(key) ?? 0) + 1);
}
requireThat(
  native.flags.length === 1024 &&
    flags.size === 512 &&
    [...flags.values()].every((n) => n === 2),
  "Incomplete byte/boolean control coverage",
);
const graphs = new Set(),
  cases = new Set();
let frames = 0;
for (const entry of native.cases) {
  graphs.add(entry.graphSha256);
  const key = `${entry.graphSha256}:${entry.schedule}`;
  requireThat(!cases.has(key), "Duplicate control schedule");
  cases.add(key);
  const ref = bound.templates.find((ref) => ref.sha256 === entry.graphSha256);
  requireThat(
    ref &&
      JSON.stringify(ref) === JSON.stringify(entry.ref) &&
      entry.frames.length === 61 &&
      ["running", "suspend-drain", "suspend-resume"].includes(entry.schedule) &&
      entry.seedHex === "0000000000000001" &&
      entry.quality === 0,
    "Continuous control cohort changed",
  );
  for (const [tick, frame] of entry.frames.entries()) {
    const expected =
      entry.schedule !== "running" &&
      tick >= 9 &&
      (entry.schedule === "suspend-drain" || tick < 36);
    requireThat(
      frame.input.time === tick / 30 &&
        frame.suspended === expected &&
        !!(frame.control.after & 2) === expected &&
        (!expected || frame.output.state.births.length === 0) &&
        (entry.schedule !== "suspend-drain" ||
          tick < 31 ||
          frame.output.state.vectors.life.count === 0),
      "Native suspension, timing or drain evidence differs",
    );
    frames++;
  }
  if (entry.schedule === "suspend-resume")
    requireThat(
      entry.frames.slice(36).some((f) => f.output.state.births.length > 0),
      "Native emission did not resume",
    );
  const summary = visual.summary.find(
    (row) =>
      row.graphSha256 === entry.graphSha256 && row.schedule === entry.schedule,
  );
  const alive = entry.frames.map((f) => f.output.state.vectors.life.count),
    births = entry.frames.map((f) => f.output.state.births.length);
  requireThat(
    summary &&
      summary.births === births.reduce((a, b) => a + b, 0) &&
      summary.peakAlive === Math.max(...alive) &&
      summary.aliveAt1Second === alive[30] &&
      summary.aliveAt2Seconds === alive[60] &&
      summary.birthsAtResume === births[36],
    "Visual summary differs from native observations",
  );
}
const counts = comparison.counts;
requireThat(
  graphs.size === 6 &&
    cases.size === 18 &&
    frames === 1098 &&
    visual.summary.length === 18 &&
    counts.flagChecks === native.flags.length &&
    counts.graphs === graphs.size &&
    counts.cases === cases.size &&
    counts.previewFrames === frames &&
    counts.resetFrames === frames &&
    counts.crossGraphRestoreFrames === 18 * 48 &&
    counts.frameChecks === 2 * frames + 18 * 48 &&
    counts.mismatches === 0 &&
    comparison.mismatches.length === 0 &&
    counts.previewMismatches === comparison.previewMismatches.length &&
    counts.previewMismatches === 3 &&
    counts.previewGeometryMismatches === 0 &&
    counts.previewPersistentStateMismatches === 3 &&
    comparison.previewMismatches.every(
      (m) => !m.geometryBytesDiffer && m.persistentStateDiffer,
    ) &&
    comparison.scope.tolerance === 0 &&
    comparison.scope.conditionalNativeHostMathParity &&
    !comparison.scope.browserRun &&
    !comparison.scope.leagueReferenceCompared &&
    JSON.stringify(visual.counts) === JSON.stringify(counts),
  "Native/WASM comparison is incomplete or its unresolved math differences changed",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-vfx-control.mjs`],
  target: "browser",
});
requireThat(
  build.success && build.outputs.length === 1,
  "Control component failed browser-target build",
);

const paths = new Map(),
  add = (url, file) => paths.set(url, file);
for (const [name, file] of [
  ["vfx-control-native.json", nativePath],
  ["vfx-control-comparison.json", comparisonPath],
]) {
  await Bun.write(`${assets}/evidence/${name}`, await read(file));
  add(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
}
for (const name of ["latest-vfx-control.json", "latest-vfx-control.png"])
  add(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
add("/assets/latest-vfx-control/package.json", packagePath);
for (const name of [
  "profile.json",
  "image.bin",
  "vfx-spawn.json",
  "vfx-emitter.json",
  "vfx-postload.json",
  "vfx-bound-quads.json",
  "vfx-samplers.json",
])
  add(`/assets/decoder-16.21-macos/${name}`, `${decoder}/${name}`);
for (const ref of bound.templates.filter(
  (ref) => graphs.has(ref.sha256) || ref === bound.templates[0],
))
  add(`/assets/decoder-16.21-macos/${ref.file}`, `${decoder}/${ref.file}`);
add(
  "/assets/vendor/unicorn_x86_candidate.mjs",
  `${assets}/vendor/unicorn_x86_candidate.mjs`,
);
const visited = new Set();
async function includeModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  add(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const match of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await includeModule(resolve(dirname(file), match[1]));
}
await includeModule(`${root}/latest-vfx-control.mjs`);
await includeModule(`${root}/latest-vfx-bound-quads.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  add(`/${name}`, `${root}/${name}`);
const results = [];
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [path, file] of paths) {
    const response = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(30000),
      }),
      expected = sha(await read(file));
    requireThat(
      response.status === 200 && sha(await response.arrayBuffer()) === expected,
      `Control publication differs: ${base}${path}`,
    );
    results.push({ base, path, status: response.status, sha256: expected });
  }
await Bun.write(
  `${cache}/research/vfx-control-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "native-emission-control-publication",
      build: prepared.build,
      publisherSha256: sha(await read(import.meta.path)),
      packageSha256: native.packageSha256,
      nativeEvidenceSha256: comparison.nativeEvidenceSha256,
      comparisonSha256: visual.comparisonSha256,
      visualSha256: sha(await read(visualPath)),
      counts,
      browserBuildSha256: sha(await build.outputs[0].arrayBuffer()),
      results,
      scope: {
        browserTargetBuild: true,
        controlledNativeObservations: true,
        systemRetirement: false,
        replayEventMapping: false,
        mainViewerIntegrated: false,
        browserRun: false,
        leagueReferenceCompared: false,
        productionDeployment: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ matchedFiles: results.length, counts }));
