// Compare the browser-compatible control component with original CPU evidence.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestVfxBoundQuads } from "../latest-vfx-bound-quads.mjs";
import { createLatestVfxControl } from "../latest-vfx-control.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-vfx-control.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  decoder = `${cache}/public/decoder-16.21-macos`;
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  inputs = {};
const raw = async (path) => {
  const data = new Uint8Array(await Bun.file(path).arrayBuffer());
  inputs[path] = sha(data);
  return data;
};
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const profile = await json(`${decoder}/profile.json`),
  meta = await json(`${decoder}/vfx-bound-quads.json`);
const evidence = await json(`${cache}/research/vfx-control-native.json`),
  packageBytes = await raw(`${cache}/public/latest-vfx-control/package.json`);
const controlMeta = JSON.parse(new TextDecoder().decode(packageBytes)),
  image = await raw(`${decoder}/image.bin`);
if (
  sha(packageBytes) !== evidence.packageSha256 ||
  evidence.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
  inputs[`${decoder}/vfx-bound-quads.json`] !== profile.vfxBoundQuadsSha256 ||
  sha(image) !== profile.decoderImageSha256
)
  throw Error("Control/native evidence package mismatch");
for (const [name, expected] of Object.entries({
  ...meta.compilerSources,
  ...evidence.sources,
}))
  if (sha(await raw(`${root}/tools/${name}`)) !== expected)
    throw Error(`Control native source changed: ${name}`);
for (const [path, expected] of Object.entries(evidence.inputs))
  if (sha(await raw(path)) !== expected)
    throw Error(`Control observation input changed: ${path}`);
for (const block of evidence.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Observed native control/simulation code changed");
const vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
if (sha(await raw(vendor)) !== controlMeta.runtimeSha256)
  throw Error("Control WASM runtime changed");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href);
const runtime = await createLatestVfxBoundQuads(
  await createUnicorn(),
  profile,
  image,
  await raw(`${decoder}/vfx-spawn.json`),
  await raw(`${decoder}/vfx-emitter.json`),
  await raw(`${decoder}/vfx-postload.json`),
  await raw(`${decoder}/vfx-bound-quads.json`),
  await raw(`${decoder}/${evidence.cases[0].ref.file}`),
);
const control = await createLatestVfxControl(
    runtime,
    profile,
    image,
    packageBytes,
    evidence.packageSha256,
  ),
  handles = new Map();
const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "number" && Object.is(v, -0)
      ? "negative-zero"
      : v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
  );
const previewMath = runtime.kernel.math;
const mismatches = [],
  previewMismatches = [];
let queue = [],
  cursor = 0,
  libraryCalls = 0,
  frameChecks = 0,
  restores = 0,
  resets = 0,
  flagChecks = 0;
const nativeNames = {
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
};
const oracleMath = Object.fromEntries(
  Object.entries(nativeNames).map(([name, nativeName]) => [
    name,
    (...args) => {
      const expected = queue[cursor++];
      if (
        !expected ||
        expected.name !== nativeName ||
        expected.args.length !== args.length ||
        expected.args.some((value, index) => !Object.is(value, args[index]))
      )
        throw Error(`Control-frame host library input differs: ${nativeName}`);
      libraryCalls++;
      return name === "sincosf"
        ? [...expected.result]
        : name === "modff"
          ? { fraction: expected.result[0], integer: expected.integer }
          : expected.result[0];
    },
  ]),
);
const check = (actual, expected, detail, target = mismatches) => {
  if (canonical(actual) === canonical(expected)) return;
  const fields = [];
  function walk(a, b, path) {
    if (canonical(a) === canonical(b) || fields.length >= 6) return;
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        walk(a[key], b[key], `${path}.${key}`);
    } else {
      const field = {
        path,
        actual: String(a).slice(0, 160),
        expected: String(b).slice(0, 160),
      };
      if (
        typeof a === "string" &&
        typeof b === "string" &&
        a.length === b.length &&
        /^[a-f0-9]+$/.test(a) &&
        /^[a-f0-9]+$/.test(b)
      ) {
        let at = 0;
        while (a[at] === b[at]) at++;
        const byte = Math.floor(at / 2);
        field.firstDifferingByte = byte;
        field.actual = a.slice(Math.max(0, byte * 2 - 16), byte * 2 + 32);
        field.expected = b.slice(Math.max(0, byte * 2 - 16), byte * 2 + 32);
      }
      fields.push(field);
    }
  }
  walk(actual, expected, "output");
  const observation = { ...detail, fields };
  if (
    actual?.geometry &&
    expected?.geometry &&
    actual?.state &&
    expected?.state
  ) {
    observation.geometryBytesDiffer = [
      "verticesHex",
      "indicesHex",
      "drawHex",
    ].some((key) => actual.geometry[key] !== expected.geometry[key]);
    observation.persistentStateDiffer = [
      "vectors",
      "rngHex",
      "actorHex",
      "poolHex",
    ].some(
      (key) => canonical(actual.state[key]) !== canonical(expected.state[key]),
    );
    observation.hostLibraryResultsDiffer =
      canonical(actual.state.mathCalls) !== canonical(expected.state.mathCalls);
  }
  target.push(observation);
};
function reset(handle, seed, quality, math) {
  queue = [];
  cursor = 0;
  runtime.kernel.math = math;
  runtime.selectGraph(handle);
  runtime.reset(seed, quality);
}
function observedFrame(frame, detail) {
  queue = frame.libraryInputs;
  cursor = 0;
  runtime.kernel.math = oracleMath;
  const scratch = runtime.kernel.read(
      controlMeta.controlAddress,
      controlMeta.scratchBytes,
    ),
    lists = [
      runtime.kernel.a.system + 0x40,
      runtime.kernel.a.system + 0x60,
    ].map((at) => runtime.kernel.read(at, 16));
  check(control.applySuspended(frame.suspended), frame.control, {
    ...detail,
    kind: "control",
  });
  check(
    [
      ...runtime.kernel.read(
        controlMeta.controlAddress,
        controlMeta.scratchBytes,
      ),
    ],
    [...scratch],
    { ...detail, kind: "scratch" },
  );
  for (const [i, at] of [
    runtime.kernel.a.system + 0x40,
    runtime.kernel.a.system + 0x60,
  ].entries())
    check([...runtime.kernel.read(at, 16)], [...lists[i]], {
      ...detail,
      kind: "list-restoration",
    });
  const actual = runtime.frame(frame.input);
  if (cursor !== queue.length)
    throw Error("Unconsumed original host library observations");
  check(actual, frame.output, detail);
  frameChecks++;
  return actual;
}
try {
  for (const entry of evidence.cases)
    if (!handles.has(entry.graphSha256)) {
      const bytes = await raw(`${decoder}/${entry.ref.file}`);
      if (sha(bytes) !== entry.graphSha256)
        throw Error("Control simulation graph changed");
      handles.set(entry.graphSha256, await runtime.loadGraph(bytes));
    }
  reset(handles.get(evidence.cases[0].graphSha256), 1n, 0, oracleMath);
  for (const flag of evidence.flags) {
    runtime.kernel.put(runtime.kernel.a.actor + 0x18, [flag.initial], "u8");
    const before = runtime.readState(),
      actual = control.applySuspended(flag.suspended),
      after = runtime.readState();
    check(actual, flag.result, { kind: "flag-probe", flag: flagChecks });
    const actorBefore = before.actorHex,
      actorAfter = after.actorHex;
    check(
      actorAfter.slice(0, 48) +
        actorBefore.slice(48, 50) +
        actorAfter.slice(50),
      actorBefore,
      { kind: "actor-preservation", flag: flagChecks },
    );
    for (const field of ["vectors", "rngHex", "poolHex"])
      check(after[field], before[field], {
        kind: "persistent-preservation",
        field,
        flag: flagChecks,
      });
    flagChecks++;
  }
  for (const [index, entry] of evidence.cases.entries()) {
    const handle = handles.get(entry.graphSha256);
    reset(handle, BigInt(`0x${entry.seedHex}`), entry.quality, oracleMath);
    let saved;
    for (const [frameIndex, frame] of entry.frames.entries()) {
      observedFrame(frame, { case: index, frame: frameIndex, kind: "forward" });
      if (frameIndex === 12) saved = runtime.checkpoint();
    }
    const other = [...handles].find(
      ([digest]) => digest !== entry.graphSha256,
    )[1];
    reset(other, 987654321n, 0, previewMath);
    control.applySuspended(false);
    runtime.frame(entry.frames[0].input);
    runtime.restore(saved);
    for (let i = 13; i < entry.frames.length; i++) {
      observedFrame(entry.frames[i], {
        case: index,
        frame: i,
        kind: "cross-graph-restore",
      });
      restores++;
    }
    runtime.releaseCheckpoint(saved);
    reset(handle, BigInt(`0x${entry.seedHex}`), entry.quality, oracleMath);
    for (const [i, frame] of entry.frames.entries()) {
      observedFrame(frame, { case: index, frame: i, kind: "reset" });
      resets++;
    }
    reset(handle, BigInt(`0x${entry.seedHex}`), entry.quality, previewMath);
    for (const [i, frame] of entry.frames.entries()) {
      control.applySuspended(frame.suspended);
      check(
        runtime.frame(frame.input),
        frame.output,
        { case: index, frame: i, kind: "default-preview-math" },
        previewMismatches,
      );
    }
    console.log(
      JSON.stringify({
        completed: index + 1,
        total: evidence.cases.length,
        mismatches: mismatches.length,
        previewMismatches: previewMismatches.length,
      }),
    );
  }
  const sources = {};
  for (const name of [
    "latest-vfx-control.mjs",
    "latest-vfx-bound-quads.mjs",
    "latest-vfx-legacy-quads.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-emitter.mjs",
    "native-decoder.mjs",
  ])
    sources[name] = sha(await raw(`${root}/${name}`));
  const result = {
    schema: 1,
    kind: "native-wasm-emission-control-comparison",
    build: controlMeta.build,
    protocol: controlMeta.protocol,
    packageSha256: evidence.packageSha256,
    nativeEvidenceSha256: inputs[`${cache}/research/vfx-control-native.json`],
    inspectorSha256: sha(await raw(import.meta.path)),
    sources,
    inputs,
    counts: {
      flagChecks,
      graphs: handles.size,
      cases: evidence.cases.length,
      frameChecks,
      crossGraphRestoreFrames: restores,
      resetFrames: resets,
      nativeHostLibraryCalls: libraryCalls,
      mismatches: mismatches.length,
      previewFrames: evidence.cases.reduce(
        (sum, c) => sum + c.frames.length,
        0,
      ),
      previewMismatches: previewMismatches.length,
      previewGeometryMismatches: previewMismatches.filter(
        (m) => m.geometryBytesDiffer,
      ).length,
      previewPersistentStateMismatches: previewMismatches.filter(
        (m) => m.persistentStateDiffer,
      ).length,
    },
    mismatches,
    previewMismatches,
    scope: {
      conditionalNativeHostMathParity: true,
      tolerance: 0,
      systemRetirement: false,
      replayEventMapping: false,
      mainViewerIntegrated: false,
      browserRun: false,
      leagueReferenceCompared: false,
    },
  };
  await Bun.write(
    `${cache}/research/vfx-control-comparison.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result.counts));
  if (mismatches.length)
    throw Error("Native emission-control comparison failed");
} finally {
  control.close();
  runtime.close();
}
