// Compare complete CameraTrail state/geometry, reset and interleaved seeking.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual as equal } from "node:util";
import {
  TRAIL_PARTICLES_SHA,
  createLatestTrailParticles,
} from "../latest-trail-particles.mjs";

const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-trail-particles.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  directory = `${assets}/latest-trail-particles`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {},
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  packageBytes = await raw(`${directory}/package.json`),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  nativePath = `${cache}/research/trail-particles-native.json`,
  native = await read(nativePath),
  profile = await read(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  spawnBytes = await raw(`${decoder}/vfx-spawn.json`),
  emitterBytes = await raw(`${decoder}/vfx-emitter.json`),
  boundBytes = await raw(`${decoder}/vfx-bound-quads.json`),
  vendor = `${assets}/vendor/unicorn_x86_candidate.mjs`;
check(
  sha(packageBytes) === TRAIL_PARTICLES_SHA &&
    native.packageSha256 === TRAIL_PARTICLES_SHA &&
    sha(await raw(vendor)) === meta.runtimeSha256 &&
    native.observerSha256 ===
      sha(await raw(`${root}/tools/observe-trail-particles.py`)),
  "Trail native observation changed",
);
for (const [name, h] of Object.entries(meta.compilerSources))
  check(
    native.compilerSources[name] === h &&
      sha(await raw(`${root}/tools/${name}`)) === h,
    `Trail compiler changed: ${name}`,
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Trail native instructions changed",
  );
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  runtime = await createLatestTrailParticles(
    uc,
    profile,
    image,
    spawnBytes,
    emitterBytes,
    boundBytes,
    packageBytes,
    await raw(`${directory}/${meta.templates[0].file}`),
  ),
  handles = new Map(),
  previewMath = runtime.kernel.math,
  counts = {
    graphs: 0,
    frames: 0,
    births: 0,
    vertices: 0,
    indices: 0,
    checkpointFrames: 0,
    resetFrames: 0,
    previewFrames: 0,
    previewStateDifferences: 0,
    previewGeometryDifferences: 0,
    previewGeometryByteDifferences: 0,
    previewWriterMathDifferences: 0,
    libraryCalls: 0,
    completeAssetBytes: 0,
    rejectionChecks: 0,
  },
  previewDifferences = [];
let queue = [],
  cursor = 0;
const names = {
    sincosf: "___sincosf_stret",
    sinf: "_sinf",
    cosf: "_cosf",
    sqrtf: "_sqrtf",
    acosf: "_acosf",
    atan2f: "_atan2f",
    fmodf: "_fmodf",
    powf: "_powf",
    expf: "_expf",
    modff: "_modff",
  },
  oracle = Object.fromEntries(
    Object.entries(names).map(([name, nativeName]) => [
      name,
      (...args) => {
        const expected = queue[cursor++];
        check(
          expected &&
            expected.name === nativeName &&
            equal(expected.args, args),
          `Trail math input differs ${nativeName}, call ${cursor}`,
        );
        counts.libraryCalls++;
        return name === "sincosf"
          ? [...expected.result]
          : name === "modff"
            ? { fraction: expected.result[0], integer: expected.integer }
            : expected.result[0];
      },
    ]),
  );
const reset = (c, math) => {
  queue = [];
  cursor = 0;
  runtime.kernel.math = math;
  runtime.reset(BigInt(`0x${c.seedHex}`), c.quality);
  check(cursor === 0, "Unexpected trail reset math");
};
const frame = (f) => {
  queue = f.libraryInputs;
  cursor = 0;
  runtime.kernel.math = oracle;
  const result = runtime.frame(f.input);
  check(cursor === queue.length, "Unconsumed trail math");
  return result;
};
const compare = (actual, expected, label) =>
  check(equal(actual, expected), `Native trail differs: ${label}`);
try {
  for (const ref of meta.templates) {
    const b = await raw(`${directory}/${ref.file}`),
      g = JSON.parse(new TextDecoder().decode(b));
    check(
      sha(b) === ref.sha256 &&
        g.assetObjectHex === g.segments[0].bytesHex.slice(0, 0x8e0) &&
        g.assetHeapBytes === g.segments[1].bytesHex.length / 2,
      "Complete trail asset changed",
    );
    handles.set(ref.sha256, await runtime.loadGraph(b));
    counts.graphs++;
    counts.completeAssetBytes += 0x470 + g.assetHeapBytes;
  }
  const checkpoints = [];
  for (const [index, c] of native.cases.entries()) {
    runtime.selectGraph(handles.get(c.graphSha256));
    reset(c, oracle);
    for (const [i, f] of c.frames.entries()) {
      const actual = frame(f);
      compare(actual, f.output, `${index}:${i}`);
      counts.frames++;
      counts.births += actual.state.births.length;
      counts.vertices += actual.geometry.verticesHex.length / 56;
      counts.indices += actual.geometry.indicesHex.length / 4;
      if (i === 7) checkpoints.push({ case: c, handle: runtime.checkpoint() });
    }
    reset(c, oracle);
    for (const f of c.frames) {
      compare(frame(f), f.output, `${index}:reset`);
      counts.resetFrames++;
    }
    reset(c, previewMath);
    for (const [i, f] of c.frames.entries()) {
      const actual = runtime.frame(f.input);
      counts.previewFrames++;
      const stateDiff = !equal(actual.state, f.output.state),
        geometryDiff = !equal(actual.geometry, f.output.geometry);
      if (stateDiff) counts.previewStateDifferences++;
      if (geometryDiff) counts.previewGeometryDifferences++;
      const geometryByteDiff = ["verticesHex", "indicesHex", "drawHex"].some(
          (name) => actual.geometry[name] !== f.output.geometry[name],
        ),
        writerMathDiff = !equal(
          actual.geometry.mathCalls,
          f.output.geometry.mathCalls,
        );
      if (geometryByteDiff) counts.previewGeometryByteDifferences++;
      if (writerMathDiff) counts.previewWriterMathDifferences++;
      if ((stateDiff || geometryDiff) && previewDifferences.length < 12)
        previewDifferences.push({
          case: index,
          frame: i,
          effectId: c.effectId,
          emitterIndex: c.emitterIndex,
          stateDiff,
          geometryDiff,
          geometryByteDiff,
          writerMathDiff,
        });
    }
    if ((index + 1) % 20 === 0)
      console.log(JSON.stringify({ cases: index + 1, ...counts }));
  }
  // Reverse order forces restoration after other graphs and random streams.
  for (const saved of checkpoints.reverse()) {
    runtime.restore(saved.handle);
    for (const f of saved.case.frames.slice(8)) {
      compare(frame(f), f.output, "interleaved checkpoint");
      counts.checkpointFrames++;
    }
    runtime.releaseCheckpoint(saved.handle);
  }
  const rejects = async (fn) => {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    check(threw, "Invalid trail input accepted");
    counts.rejectionChecks++;
  };
  await rejects(() => runtime.loadGraph(new Uint8Array()));
  await rejects(() => runtime.restore({}));
  await rejects(() => runtime.reset(1n, 4));
  await rejects(() =>
    runtime.renderGeometry([0, 1, 0], {
      axis: [0, 2, 0],
      multTexturePresent: false,
    }),
  );
  await rejects(() =>
    runtime.frame({ ...native.cases[0].frames[0].input, time: -1 }),
  );
} finally {
  runtime.close();
}
const sources = {};
for (const name of [
  "latest-trail-particles.mjs",
  "latest-vfx-legacy-quads.mjs",
  "latest-vfx-spawn.mjs",
  "latest-vfx-emitter.mjs",
  "native-decoder.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
await Bun.write(
  `${cache}/research/trail-particles-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "complete-trail-native-wasm-comparison",
      packageSha256: TRAIL_PARTICLES_SHA,
      nativeSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      previewDifferences,
      scope: {
        ...meta.scope,
        nativeStateAndGeometryCompared: true,
        nativeMathParityConditionalOnRecordedLibraryOutputs: true,
        previewMathComparedSeparately: true,
        checkpointsCompared: true,
        browserRun: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
