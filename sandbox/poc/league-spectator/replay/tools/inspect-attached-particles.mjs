// Native/WASM pool-state comparison, with a distinct preview-math observation.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  ATTACHED_PARTICLES_SHA,
  createLatestAttachedParticles,
} from "../latest-attached-particles.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-attached-particles.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  directory = `${assets}/latest-attached-particles`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  packageBytes = await raw(`${directory}/package.json`),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  nativePath = `${cache}/research/attached-particles-native.json`,
  native = await json(nativePath),
  profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  spawnBytes = await raw(`${decoder}/vfx-spawn.json`),
  emitterBytes = await raw(`${decoder}/vfx-emitter.json`),
  boundBytes = await raw(`${decoder}/vfx-bound-quads.json`),
  vendor = `${assets}/vendor/unicorn_x86_candidate.mjs`;
check(
  sha(packageBytes) === ATTACHED_PARTICLES_SHA &&
    native.packageSha256 === ATTACHED_PARTICLES_SHA &&
    sha(image) === meta.decoderImageSha256 &&
    sha(await raw(vendor)) === meta.runtimeSha256 &&
    native.observerSha256 ===
      sha(await raw(`${root}/tools/observe-attached-particles.py`)),
  "Attached pool observation differs",
);
for (const [path, h] of Object.entries(meta.inputs))
  check(
    sha(await raw(path)) === h,
    `Attached pool preparation input changed: ${path}`,
  );
for (const [name, h] of Object.entries(meta.compilerSources))
  check(
    native.compilerSources[name] === h &&
      sha(await raw(`${root}/tools/${name}`)) === h,
    `Attached pool native source changed: ${name}`,
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Attached pool native instructions changed",
  );
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  runtime = await createLatestAttachedParticles(
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
    checkpointFrames: 0,
    resetFrames: 0,
    previewFrames: 0,
    previewDifferences: 0,
    drawInputChecks: 0,
    completeAssetBytes: 0,
    libraryCalls: 0,
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
            expected.args.length === args.length &&
            expected.args.every((v, i) => Object.is(v, args[i])),
          `Attached native math input differs: ${nativeName}`,
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
function reset(seed, quality, math) {
  queue = [];
  cursor = 0;
  runtime.kernel.math = math;
  runtime.reset(seed, quality);
  check(cursor === 0, "Unexpected native reset math input");
}
function frame(f) {
  queue = f.libraryInputs;
  cursor = 0;
  runtime.kernel.math = oracle;
  const result = runtime.frame(f.input);
  check(cursor === queue.length, "Unconsumed attached native math calls");
  compare(runtime.drawValues(), f.drawValues, "draw inputs");
  counts.drawInputChecks += f.drawValues.length;
  return result;
}
function compare(a, b, label) {
  if (!isDeepStrictEqual(a, b)) {
    const fields = [];
    for (const key of Object.keys(b))
      if (!isDeepStrictEqual(a[key], b[key])) fields.push(key);
    throw Error(`Attached pool differs ${label}: ${fields.join(",")}`);
  }
}
try {
  for (const ref of meta.templates) {
    const b = await raw(`${directory}/${ref.file}`),
      graph = JSON.parse(new TextDecoder().decode(b)),
      s = await json(`${decoder}/${ref.postloadGraphFile}`);
    check(
      sha(b) === ref.sha256 &&
        graph.assetObjectHex === s.objectHex &&
        graph.segments[0].bytesHex.slice(0, 0x8e0) === s.objectHex &&
        graph.segments[1].address === s.heapStart &&
        graph.segments[1].bytesHex === s.heapHex,
      "Attached complete asset changed",
    );
    counts.completeAssetBytes += 0x470 + s.heapHex.length / 2;
    handles.set(ref.sha256, await runtime.loadGraph(b));
    counts.graphs++;
  }
  for (const [index, c] of native.cases.entries()) {
    const handle = handles.get(c.graphSha256);
    check(handle, "Unprepared native attached pool case");
    runtime.selectGraph(handle);
    reset(BigInt(`0x${c.seedHex}`), c.quality, oracle);
    let saved = null;
    for (const [i, f] of c.frames.entries()) {
      const actual = frame(f);
      compare(actual, f.state, `${index}:${i}`);
      counts.frames++;
      counts.births += actual.births.length;
      if (i === 7) saved = runtime.checkpoint();
    }
    runtime.restore(saved);
    for (const f of c.frames.slice(8)) {
      compare(frame(f), f.state, `${index}:checkpoint`);
      counts.checkpointFrames++;
    }
    runtime.releaseCheckpoint(saved);
    reset(BigInt(`0x${c.seedHex}`), c.quality, oracle);
    for (const f of c.frames) {
      compare(frame(f), f.state, `${index}:reset`);
      counts.resetFrames++;
    }
    reset(BigInt(`0x${c.seedHex}`), c.quality, previewMath);
    for (const [i, f] of c.frames.entries()) {
      const actual = runtime.frame(f.input);
      counts.previewFrames++;
      compare(runtime.drawValues(), f.drawValues, "preview draw inputs");
      counts.drawInputChecks += f.drawValues.length;
      if (!isDeepStrictEqual(actual, f.state)) {
        counts.previewDifferences++;
        if (previewDifferences.length < 8)
          previewDifferences.push({
            case: index,
            frame: i,
            effectId: c.effectId,
            emitterIndex: c.emitterIndex,
          });
      }
    }
    if ((index + 1) % 30 === 0)
      console.log(
        JSON.stringify({
          cases: index + 1,
          frames: counts.frames,
          previewDifferences: counts.previewDifferences,
        }),
      );
  }
  async function rejects(fn) {
    let rejected = false;
    try {
      await fn();
    } catch {
      rejected = true;
    }
    check(rejected, "Invalid attached pool request accepted");
    counts.rejectionChecks++;
  }
  await rejects(() => runtime.renderGeometry([0, 0, 1000]));
  await rejects(() => runtime.loadGraph(new Uint8Array()));
  await rejects(() => runtime.restore({}));
  await rejects(() => runtime.reset(1n, 4));
  const b = await raw(`${directory}/${meta.templates[0].file}`);
  await rejects(() =>
    createLatestAttachedParticles(
      uc,
      { ...profile, clientVersion: "wrong" },
      image,
      spawnBytes,
      emitterBytes,
      boundBytes,
      packageBytes,
      b,
    ),
  );
} finally {
  runtime.close();
}
const sources = {};
for (const name of [
  "latest-attached-particles.mjs",
  "latest-vfx-legacy-quads.mjs",
  "latest-vfx-spawn.mjs",
  "latest-vfx-emitter.mjs",
  "native-decoder.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "attached-particle-native-wasm-comparison",
  packageSha256: ATTACHED_PARTICLES_SHA,
  nativeSha256: inputs[nativePath],
  inspectorSha256: sha(await raw(import.meta.path)),
  inputs,
  sources,
  counts,
  previewDifferences,
  scope: {
    ...native.scope,
    nativePoolStateCompared: true,
    checkpointsCompared: true,
    previewMathComparedSeparately: true,
    nativeMathParityConditionalOnRecordedLibraryOutputs: true,
    browserRun: false,
    mainViewerIntegrated: false,
    ownerPoseBindingExecuted: false,
    referencePixelsCompared: false,
  },
};
await Bun.write(
  `${cache}/research/attached-particles-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(counts));
