// Native/WASM retirement observations, default-math differences and seeking.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestVfxBoundQuads } from "../latest-vfx-bound-quads.mjs";
import { createLatestVfxRetirement } from "../latest-vfx-retirement.mjs";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-vfx-retirement.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  decoder = `${cache}/public/decoder-16.21-macos`;
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  inputs = {};
const raw = async (path) => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  inputs[path] = sha(bytes);
  return bytes;
};
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const profile = await json(`${decoder}/profile.json`),
  bound = await json(`${decoder}/vfx-bound-quads.json`),
  system = await json(`${decoder}/vfx-system.json`),
  evidencePath = `${cache}/research/vfx-retirement-native.json`,
  evidence = await json(evidencePath),
  packageBytes = await raw(
    `${cache}/public/latest-vfx-retirement/package.json`,
  ),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  image = await raw(`${decoder}/image.bin`);
if (
  sha(packageBytes) !== evidence.packageSha256 ||
  sha(image) !== profile.decoderImageSha256 ||
  inputs[`${decoder}/vfx-bound-quads.json`] !== profile.vfxBoundQuadsSha256 ||
  inputs[`${decoder}/vfx-system.json`] !== profile.vfxSystemSha256
)
  throw Error("Retirement packages changed");
for (const [name, expected] of Object.entries({
  ...bound.compilerSources,
  ...system.compilerSources,
  ...evidence.sources,
}))
  if (sha(await raw(`${root}/tools/${name}`)) !== expected)
    throw Error(`Native retirement source changed: ${name}`);
for (const [path, expected] of Object.entries(evidence.inputs))
  if (sha(await raw(path)) !== expected)
    throw Error(`Native retirement input changed: ${path}`);
for (const block of evidence.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Observed original retirement code changed");
const vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
if (sha(await raw(vendor)) !== meta.runtimeSha256)
  throw Error("Retirement WASM runtime changed");
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
const retirement = await createLatestVfxRetirement(
    runtime,
    profile,
    image,
    packageBytes,
    evidence.packageSha256,
  ),
  k = runtime.kernel,
  previewMath = k.math,
  handles = new Map(),
  mismatches = [],
  previewMismatches = [];
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
function check(actual, expected, detail, target = mismatches) {
  if (canonical(actual) === canonical(expected)) return;
  const fields = [];
  function walk(a, b, path) {
    if (canonical(a) === canonical(b) || fields.length >= 8) return;
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        walk(a[key], b[key], `${path}.${key}`);
    } else {
      const field = {
        path,
        actual: String(a).slice(0, 100),
        expected: String(b).slice(0, 100),
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
        field.firstDifferingByte = Math.floor(at / 2);
        field.actual = a.slice(Math.max(0, at - 16), at + 32);
        field.expected = b.slice(Math.max(0, at - 16), at + 32);
      }
      fields.push(field);
    }
  }
  walk(actual, expected, "output");
  target.push({ ...detail, fields });
}
let queue = [],
  cursor = 0,
  libraryCalls = 0,
  flagChecks = 0,
  scheduledChecks = 0,
  tickChecks = 0,
  restoreChecks = 0,
  resetChecks = 0;
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
        expected.args.some((v, i) => !Object.is(v, args[i]))
      )
        throw Error(`Retirement host library input differs: ${nativeName}`);
      libraryCalls++;
      return name === "sincosf"
        ? [...expected.result]
        : name === "modff"
          ? { fraction: expected.result[0], integer: expected.integer }
          : expected.result[0];
    },
  ]),
);
function reset(entry, math = oracleMath) {
  queue = [];
  cursor = 0;
  k.math = math;
  runtime.selectGraph(handles.get(entry.ref.sha256));
  runtime.reset(BigInt(`0x${entry.seedHex}`), entry.quality);
  const initial = retirement.initialize(entry.createdAt);
  check(initial, entry.initial, {
    kind: "initial",
    effect: entry.ref.effectId,
  });
  check(retirement.osCalls, entry.initialOsCalls, {
    kind: "initial-os",
    effect: entry.ref.effectId,
  });
}
function observeFrame(entry, frame, detail, defaultMath = false) {
  const target = defaultMath ? previewMismatches : mismatches;
  queue = frame.libraryInputs;
  cursor = 0;
  k.math = defaultMath ? previewMath : oracleMath;
  retirement.osCalls = [];
  if (frame.retirementRequested) {
    check(
      retirement.lifecycle(),
      frame.beforeRequest,
      { ...detail, field: "before-request" },
      target,
    );
    check(
      retirement.request(entry.schedule === "mode-true"),
      frame.afterRequest,
      { ...detail, field: "after-request" },
      target,
    );
  }
  if (frame.output) {
    check(retirement.tick(frame.input), frame.output, detail, target);
    check(
      retirement.collect(),
      frame.collected,
      { ...detail, field: "collected" },
      target,
    );
    if (!defaultMath) tickChecks++;
  } else {
    check(
      retirement.lifecycle(),
      frame.collected,
      { ...detail, field: "deferred" },
      target,
    );
  }
  check(
    retirement.osCalls,
    frame.osCalls,
    { ...detail, field: "os-calls" },
    target,
  );
  if (!defaultMath && cursor !== queue.length)
    throw Error("Unconsumed native retirement math observations");
  if (!defaultMath) scheduledChecks++;
}
try {
  for (const entry of evidence.cases)
    if (!handles.has(entry.ref.sha256)) {
      const bytes = await raw(`${decoder}/${entry.ref.file}`);
      if (sha(bytes) !== entry.ref.sha256)
        throw Error("Retirement graph changed");
      handles.set(entry.ref.sha256, await runtime.loadGraph(bytes));
    }
  reset(evidence.cases[0]);
  for (const [index, probe] of evidence.flags.entries()) {
    const flags = new Uint8Array(2);
    new DataView(flags.buffer).setUint16(0, probe.initial, true);
    k.engine.mem_write(k.a.system + 0x2a9, flags);
    k.put(k.a.manager + 0x1d8, [0], "u32");
    const before = runtime.readState(),
      life = retirement.request(probe.mode),
      after = runtime.readState();
    check(
      {
        initial: probe.initial,
        mode: probe.mode,
        after: life.flags,
        queued: life.lists.retiring.count,
      },
      probe,
      { kind: "flag", index },
    );
    for (const field of ["vectors", "rngHex", "actorHex", "poolHex"])
      check(after[field], before[field], {
        kind: "flag-preservation",
        index,
        field,
      });
    flagChecks++;
  }
  for (const [caseIndex, entry] of evidence.cases.entries()) {
    reset(entry);
    const checkpoints = [];
    for (const [frameIndex, frame] of entry.frames.entries()) {
      observeFrame(entry, frame, {
        kind: "forward",
        case: caseIndex,
        frame: frameIndex,
      });
      if ([12, 31].includes(frameIndex))
        checkpoints.push({ handle: retirement.checkpoint(), frameIndex });
    }
    for (const saved of checkpoints) {
      const other = evidence.cases.find(
        (c) => c.ref.sha256 !== entry.ref.sha256,
      );
      reset(other, previewMath);
      retirement.request(false);
      retirement.tick(other.frames[0].input);
      retirement.collect();
      retirement.restore(saved.handle);
      for (let i = saved.frameIndex + 1; i < entry.frames.length; i++) {
        observeFrame(entry, entry.frames[i], {
          kind: "cross-graph-restore",
          case: caseIndex,
          frame: i,
        });
        restoreChecks++;
      }
      retirement.releaseCheckpoint(saved.handle);
    }
    reset(entry);
    for (const [i, frame] of entry.frames.entries()) {
      observeFrame(entry, frame, { kind: "reset", case: caseIndex, frame: i });
      resetChecks++;
    }
    reset(entry, previewMath);
    for (const [i, frame] of entry.frames.entries())
      observeFrame(
        entry,
        frame,
        { kind: "default-preview-math", case: caseIndex, frame: i },
        true,
      );
    console.log(
      JSON.stringify({
        completed: caseIndex + 1,
        total: evidence.cases.length,
        mismatches: mismatches.length,
        previewMismatches: previewMismatches.length,
      }),
    );
  }
  const sources = {};
  for (const name of [
    "latest-vfx-retirement.mjs",
    "latest-vfx-bound-quads.mjs",
    "latest-vfx-legacy-quads.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-emitter.mjs",
    "native-decoder.mjs",
  ])
    sources[name] = sha(await raw(`${root}/${name}`));
  const result = {
    schema: 1,
    kind: "native-wasm-system-retirement-comparison",
    build: meta.build,
    protocol: meta.protocol,
    packageSha256: evidence.packageSha256,
    nativeEvidenceSha256: inputs[evidencePath],
    inspectorSha256: sha(await raw(import.meta.path)),
    sources,
    inputs,
    counts: {
      flagChecks,
      graphs: handles.size,
      cases: evidence.cases.length,
      scheduledChecks,
      tickChecks,
      restoreChecks,
      resetChecks,
      checkpoints: evidence.cases.length * 2,
      nativeHostLibraryCalls: libraryCalls,
      mismatches: mismatches.length,
      previewMismatches: previewMismatches.length,
    },
    mismatches,
    previewMismatches,
    scope: {
      conditionalNativeHostMathParity: true,
      tolerance: 0,
      defaultParentDefinition: true,
      singleThreadMutexModel: true,
      deferredDisposalOnly: true,
      destructorExecuted: false,
      replayEventMapping: false,
      mainViewerIntegrated: false,
      browserRun: false,
      leagueReferenceCompared: false,
    },
  };
  await Bun.write(
    `${cache}/research/vfx-retirement-comparison.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result.counts));
  if (mismatches.length) throw Error("Native retirement comparison differs");
} finally {
  retirement.close();
  runtime.close();
}
