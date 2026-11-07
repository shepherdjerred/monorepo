// Publish controlled retirement evidence to the existing preview without UI.
import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-retirement.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  json = async (path) => JSON.parse(new TextDecoder().decode(await read(path)));
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const packagePath = `${assets}/latest-vfx-retirement/package.json`,
  nativePath = `${cache}/research/vfx-retirement-native.json`,
  comparisonPath = `${cache}/research/vfx-retirement-comparison.json`,
  visualPath = `${assets}/evidence/latest-vfx-retirement.json`;
const meta = await json(packagePath),
  native = await json(nativePath),
  comparison = await json(comparisonPath),
  visual = await json(visualPath),
  profile = await json(`${decoder}/profile.json`),
  bound = await json(`${decoder}/vfx-bound-quads.json`),
  system = await json(`${decoder}/vfx-system.json`),
  image = await read(`${decoder}/image.bin`);
requireThat(
  meta.kind === "native-system-retirement" &&
    meta.build === "16.21.829.8620" &&
    meta.protocol === "20e09df23c66b85e" &&
    meta.decoderImageSha256 === sha(image) &&
    meta.quadPackageSha256 === profile.vfxBoundQuadsSha256 &&
    meta.quadPackageSha256 ===
      sha(await read(`${decoder}/vfx-bound-quads.json`)) &&
    meta.systemPackageSha256 === profile.vfxSystemSha256 &&
    meta.systemPackageSha256 ===
      sha(await read(`${decoder}/vfx-system.json`)) &&
    native.packageSha256 === sha(await read(packagePath)) &&
    comparison.packageSha256 === native.packageSha256 &&
    comparison.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    visual.nativeEvidenceSha256 === comparison.nativeEvidenceSha256 &&
    visual.comparisonSha256 === sha(await read(comparisonPath)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-vfx-retirement.png`)),
  "Retirement package/evidence changed",
);
for (const record of [meta, native, comparison, visual])
  requireThat(
    record.build === meta.build &&
      record.scope.deferredDisposalOnly &&
      !record.scope.destructorExecuted &&
      !record.scope.replayEventMapping &&
      !record.scope.mainViewerIntegrated,
    "Retirement proof exceeds its admitted scope",
  );
for (const sources of [
  meta.compilerSources,
  native.sources,
  bound.compilerSources,
  system.compilerSources,
])
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
      `Stale retirement input: ${path}`,
    );
requireThat(
  comparison.inspectorSha256 ===
    sha(await read(`${root}/tools/inspect-vfx-retirement.mjs`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-vfx-retirement.py`)),
  "Retirement inspector/renderer changed",
);
for (const block of meta.sourceBlocks)
  requireThat(
    sha(image.subarray(block.startRva, block.endRva)) === block.sha256,
    "Original retirement code changed",
  );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Observed original code changed",
  );
const probes = new Set();
for (const flag of native.flags) {
  const { initial, mode, after, queued } = flag;
  const expected =
    initial & 0x80
      ? initial
      : mode
        ? (initial & 0xff5c) | 0x82
        : (initial | 0xa0) & 0xfffe;
  const key = `${initial}:${mode}`;
  requireThat(
    Number.isInteger(initial) &&
      initial >= 0 &&
      initial <= 0xffff &&
      [0, 0x4000, 0x8000, 0xff00].includes(initial & 0xff00) &&
      typeof mode === "boolean" &&
      after === expected &&
      queued === Number(!(initial & 0x80)) &&
      !probes.has(key),
    "Retirement flag truth table differs",
  );
  probes.add(key);
}
requireThat(probes.size === 2048, "Retirement flag coverage incomplete");
let frames = 0,
  ticks = 0,
  deferred = 0,
  aliveDisposals = 0,
  expectedRestoreTicks = 0;
const graphs = new Set(),
  schedules = new Set();
for (const entry of native.cases) {
  const ref = bound.templates.find((t) => t.sha256 === entry.ref.sha256),
    key = `${entry.ref.sha256}:${entry.schedule}`;
  requireThat(
    ref &&
      JSON.stringify(ref) === JSON.stringify(entry.ref) &&
      ["running", "mode-false", "mode-true"].includes(entry.schedule) &&
      !schedules.has(key) &&
      entry.frames.length === 181 &&
      entry.seedHex === "0000000000000001" &&
      entry.quality === 0 &&
      entry.createdAt === 0,
    "Retirement cohort changed",
  );
  graphs.add(ref.sha256);
  schedules.add(key);
  let disposal = null;
  for (const [tick, frame] of entry.frames.entries()) {
    frames++;
    requireThat(
      frame.input.time === tick / 30 &&
        frame.retirementRequested ===
          (entry.schedule !== "running" &&
            [30, 31].includes(tick) &&
            disposal === null),
      "Retirement request schedule differs",
    );
    if (frame.retirementRequested)
      requireThat(
        frame.afterRequest.lists.retiring.count === 1 &&
          frame.afterRequest.lists.retiring.values[0] === 0x10023000,
        "Retirement request duplicated or lost its root",
      );
    const lists = frame.collected.lists;
    requireThat(
      lists.active.count + lists.deferred.count === 1 &&
        lists.active.count <= 1 &&
        lists.retiring.count <= 1 &&
        lists.deferred.count <= 1,
      "Native root ownership changed",
    );
    if (frame.output) {
      requireThat(
        disposal === null,
        "Native scheduler ran after deferred disposal",
      );
      ticks++;
      expectedRestoreTicks += Number(tick > 12) + Number(tick > 31);
      if (lists.deferred.count) {
        disposal = tick;
        requireThat(
          lists.active.count === 0 &&
            lists.retiring.count === 0 &&
            lists.deferred.values[0] === 0x10023000 &&
            frame.collected.flags & 2,
          "Collector did not transfer a completed root",
        );
      }
    } else
      requireThat(
        disposal !== null && lists.deferred.count === 1,
        "Unexplained absent native tick",
      );
  }
  requireThat(
    disposal === entry.deferredTick &&
      (entry.schedule === "running" ? disposal === null : disposal !== null),
    "Deferred retirement timing differs",
  );
  const activeFrames = entry.frames.filter((f) => f.output),
    alive = activeFrames.map((f) => f.output.state.vectors.life.count),
    remaining =
      disposal === null
        ? null
        : entry.frames[disposal].output.state.vectors.life.count,
    summary = visual.summary.find(
      (s) => s.graphSha256 === ref.sha256 && s.schedule === entry.schedule,
    );
  requireThat(
    summary &&
      summary.deferredTick === disposal &&
      summary.poolAliveAtDisposal === remaining &&
      summary.peakAlive === Math.max(...alive) &&
      summary.births ===
        activeFrames.reduce((n, f) => n + f.output.state.births.length, 0),
    "Retirement visual summary differs",
  );
  deferred += Number(disposal !== null);
  aliveDisposals += Number(remaining !== null && remaining > 0);
}
const c = comparison.counts;
requireThat(
  graphs.size === 6 &&
    schedules.size === 18 &&
    frames === 3258 &&
    ticks === 2007 &&
    deferred === 12 &&
    aliveDisposals === 4 &&
    visual.disposalsWithLiveParticles === aliveDisposals &&
    visual.summary.length === 18 &&
    native.counts.frames === frames &&
    native.counts.executedTicks === ticks &&
    c.flagChecks === probes.size &&
    c.graphs === graphs.size &&
    c.cases === schedules.size &&
    c.checkpoints === 36 &&
    c.restoreChecks === 18 * (168 + 149) &&
    c.resetChecks === frames &&
    c.scheduledChecks === 2 * frames + c.restoreChecks &&
    c.tickChecks === 2 * ticks + expectedRestoreTicks &&
    c.mismatches === 0 &&
    comparison.mismatches.length === 0 &&
    c.previewMismatches === 0 &&
    comparison.previewMismatches.length === 0 &&
    comparison.scope.tolerance === 0 &&
    comparison.scope.conditionalNativeHostMathParity &&
    !comparison.scope.browserRun &&
    !comparison.scope.leagueReferenceCompared &&
    JSON.stringify(visual.counts) === JSON.stringify(c),
  "Retirement comparison coverage differs",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-vfx-retirement.mjs`],
  target: "browser",
});
requireThat(
  build.success && build.outputs.length === 1,
  "Retirement component failed browser-target build",
);
const paths = new Map(),
  add = (url, file) => paths.set(url, file);
for (const [name, path] of [
  ["vfx-retirement-native.json", nativePath],
  ["vfx-retirement-comparison.json", comparisonPath],
]) {
  await Bun.write(`${assets}/evidence/${name}`, await read(path));
  add(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
}
for (const name of ["latest-vfx-retirement.png", "latest-vfx-retirement.json"])
  add(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
add("/assets/latest-vfx-retirement/package.json", packagePath);
for (const name of [
  "profile.json",
  "image.bin",
  "vfx-spawn.json",
  "vfx-emitter.json",
  "vfx-postload.json",
  "vfx-bound-quads.json",
  "vfx-system.json",
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
await includeModule(`${root}/latest-vfx-retirement.mjs`);
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
      `Retirement publication differs: ${base}${path}`,
    );
    results.push({ base, path, status: response.status, sha256: expected });
  }
await Bun.write(
  `${cache}/research/vfx-retirement-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "native-system-retirement-publication",
      build: meta.build,
      publisherSha256: sha(await read(import.meta.path)),
      packageSha256: native.packageSha256,
      nativeEvidenceSha256: comparison.nativeEvidenceSha256,
      comparisonSha256: visual.comparisonSha256,
      visualSha256: sha(await read(visualPath)),
      browserBuildSha256: sha(await build.outputs[0].arrayBuffer()),
      counts: c,
      disposalsWithLiveParticles: aliveDisposals,
      results,
      scope: {
        browserTargetBuild: true,
        controlledNativeObservations: true,
        deferredDisposalOnly: true,
        destructorExecuted: false,
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
console.log(
  JSON.stringify({
    matchedFiles: results.length,
    counts: c,
    disposalsWithLiveParticles: aliveDisposals,
  }),
);
