import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  directEmptyLinkControllerCount,
  directSingleResourceLifetime,
  compileDirectEmptySingleResourceProgram,
} from "../latest-direct-effect-link-controllers.mjs";
import {
  compileDirectEmitterLifecycle,
  createDirectEmitterLifecycleState,
  beginDirectEmitterLifecycle,
  finishDirectEmitterLifecycle,
} from "../latest-direct-effect-lifecycle.mjs";
import { normalizeDirectPointEmitter } from "../latest-direct-effect-defaults.mjs";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h) throw Error("Link input drift");
  inputs[path] = h;
  return b;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
for (const path of [
  import.meta.path,
  "../latest-direct-effect-link-controllers.mjs",
  "../latest-direct-effect-lifecycle.mjs",
  "../latest-direct-effect-defaults.mjs",
  "../latest-vfx-values.mjs",
  "../structural-comparison.mjs",
])
  await raw(path.startsWith("../") ? resolve(import.meta.dir, path) : path);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Exact link image required");
async function evidence(r) {
  if (
    r.build !== "16.21.829.8620" ||
    r.protocol !== "20e09df23c66b85e" ||
    !Object.keys(r.inputs ?? {}).length ||
    !Object.keys(r.sources ?? {}).length ||
    !r.originalBlocks?.length
  )
    throw Error("Original link provenance required");
  for (const map of [r.inputs, r.sources])
    for (const [p, h] of Object.entries(map))
      if ((await sha256(await raw(p))) !== h)
        throw Error(`Stale native link input: ${p}`);
  for (const b of r.originalBlocks)
    if (
      !Number.isSafeInteger(b.rva) ||
      b.rva < 0 ||
      !Number.isSafeInteger(b.size) ||
      b.size <= 0 ||
      b.rva + b.size > image.length ||
      (await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256
    )
      throw Error("Original link block differs");
}
const exact = (a, b, name) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error(`${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};
function matrix(rows, expected, key) {
  if (!Array.isArray(rows) || rows.length !== expected.size)
    throw Error("Complete link control matrix required");
  const left = new Set(expected);
  for (const r of rows)
    if (!left.delete(JSON.stringify(key(r))))
      throw Error("Duplicate/unexpected link control");
  if (left.size) throw Error("Missing link control");
}
const native = await read(
  `${cache}/research/direct-link-controllers-native.json`,
);
await evidence(native);
if (
  native.kind !== "native-empty-material-override-link-controls" ||
  native.registration.hash !== 0x332b2c86 ||
  native.registration.offset !== 0x20 ||
  native.registration.type !== 128
)
  throw Error("Exact registered link vector required");
matrix(native.controls, new Set(['["absent"]', '["typed-empty"]']), (r) => [
  r.source,
]);
for (const r of native.controls) {
  exact(r.sourceVectorHex, "0".repeat(32), "original empty source");
  exact(r.initialLinkVectorHex, "0".repeat(32), "original link constructor");
  exact(
    r.afterLinkVectorHex,
    r.initialLinkVectorHex,
    "original vector producer",
  );
  exact(
    directEmptyLinkControllerCount(
      r.source === "absent" ? {} : { materialOverrideDefinitions: [] },
    ),
    r.count,
    "browser source projection",
  );
}
const MAX = Math.fround(3.4028234663852886e38),
  expected = new Set();
for (const l of [-1, 0, 0.5, 10.5, 10.500000953674316, MAX])
  for (const p of [-1, 0.5, MAX])
    for (const s of [false, true])
      for (const n of [0, 1]) expected.add(JSON.stringify([l, p, s, n]));
const key = (r) => [
  r.lifetime,
  r.particleLifetimeMaximum,
  r.isSingleParticle,
  r.materialOverrideCount,
];
matrix(native.singleClocks, expected, key);
let rejects = 0;
for (const changed of [
  [],
  native.singleClocks.slice(1),
  [
    native.singleClocks[0],
    native.singleClocks[0],
    ...native.singleClocks.slice(2),
  ],
]) {
  let rejected = false;
  try {
    matrix(changed, expected, key);
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Corrupt link matrix accepted");
  rejects++;
}
for (const r of native.singleClocks)
  exact(
    directSingleResourceLifetime(r).effectiveLifetime,
    r.effectiveLifetime,
    "original single clock rewrite",
  );
const paired = await read(`${cache}/research/direct-single-clock-native.json`);
await evidence(paired);
if (
  paired.kind !== "native-single-clock-before-construction-control" ||
  paired.scope.fullResourcePostloadExecuted !== false
)
  throw Error("Bounded original single clock scope required");
const scenarios = [
    "authored-default-lifetime",
    "typed-delay-with-authored-age-curve",
  ],
  variants = ["unclamped-control", "original-single-clock-rewrite"],
  seeds = ["0000000000000001", "0000000000012345"];
const pairKeys = new Set();
for (const a of scenarios)
  for (const b of variants)
    for (const c of seeds) pairKeys.add(JSON.stringify([a, b, c]));
matrix(paired.cases, pairKeys, (r) => [r.scenario, r.variant, r.seedHex]);
const manifest = await read(`${cache}/public/latest-effects/manifest.json`),
  valueRaw = await raw(`${cache}/public/decoder-16.21-macos/vfx-values.json`);
if ((await sha256(valueRaw)) !== profile.vfxValuesSha256)
  throw Error("Pinned value kernel required");
const values = createLatestVfxValues(
  JSON.parse(new TextDecoder().decode(valueRaw)),
);
const view = (hex) => new DataView(Uint8Array.fromHex(hex).buffer),
  fl = (hex, at) => view(hex).getFloat32(at, true);
let frames = 0,
  controllerSteps = 0,
  births = 0,
  birthCurveControls = 0,
  meaningfulDelayedBirths = 0;
const firstBirths = new Map();
for (const c of paired.cases) {
  if (c.frames.length !== 61)
    throw Error("Complete paired single schedule required");
  const ref = manifest.definitions[c.effectId],
    sourceRaw = await raw(`${cache}/public/latest-effects/${ref.file}`);
  if ((await sha256(sourceRaw)) !== ref.sha256)
    throw Error("Authored single source differs");
  let source = normalizeDirectPointEmitter(
    JSON.parse(new TextDecoder().decode(sourceRaw)).definition
      .complexEmitterDefinitionData[c.emitterIndex],
  );
  if (c.scenario === "typed-delay-with-authored-age-curve") {
    exact(
      c.controlledFields,
      {
        lifetime: MAX,
        timeBeforeFirstEmission: Math.fround(0.13),
        emitterLinger: 11,
      },
      "typed controlled clock fields",
    );
    source = { ...source, ...c.controlledFields };
  }
  const resource = compileDirectEmptySingleResourceProgram(
      source,
      "camera-quad",
    ),
    original = compileDirectEmitterLifecycle(source, "camera-quad");
  if (!resource || !original || resource.linkControllerCount !== 0)
    throw Error("Bounded compiled single resource program required");
  const effective =
    c.variant === "unclamped-control"
      ? resource.sourceLifetime
      : resource.effectiveLifetime;
  exact(
    fl(c.initialActorHex, 0x20),
    effective,
    "original ctor consumes derived lifetime",
  );
  const program = { ...original, lifetime: effective },
    state = createDirectEmitterLifecycleState(program, 0);
  exact(
    [fl(c.preRewriteLinkTimersHex, 0), fl(c.preRewriteLinkTimersHex, 4)],
    original.linkTimers,
    "original pre-rewrite link timers",
  );
  if (c.scenario === "typed-delay-with-authored-age-curve")
    exact(
      original.linkTimers[1],
      11,
      "nonzero original timer exposes initialization order",
    );
  for (let tick = 0; tick < 61; tick++) {
    const frame = c.frames[tick];
    exact(
      frame.linkTimersHex,
      c.preRewriteLinkTimersHex,
      "retained pre-rewrite timers on every frame",
    );
    exact(frame.input.time, tick / 60, "canonical paired clock");
    frames++;
    const time = Math.fround(frame.input.time),
      decision = beginDirectEmitterLifecycle(program, state, {
        time,
        parentFlags: 0,
      });
    const s = frame.output.state,
      life = s.vectors.life,
      data = new Float32Array(life.count * 20);
    for (let i = 0; i < life.count; i++) {
      data[i * 20] = fl(life.hex, i * 8);
      data[i * 20 + 1] = fl(life.hex, i * 8 + 4);
    }
    if (!decision.emit && s.births.length)
      throw Error("Original birth during translated single suppression");
    finishDirectEmitterLifecycle(program, state, {
      time,
      parentFlags: 0,
      decision,
      emitted: s.births.length > 0,
      data,
      count: life.count,
    });
    exact(
      state.actorFlags,
      view(s.actorHex).getUint8(0x18),
      "paired whole-emitter flags",
    );
    exact(
      state.previousActorTime,
      fl(s.actorHex, 0x24),
      "paired whole-emitter clock",
    );
    controllerSteps++;
    births += s.births.length;
    if (s.births.length) {
      firstBirths.set(
        JSON.stringify([c.scenario, c.variant, c.seedHex]),
        s.births[0].birthHex,
      );
      if (c.scenario === "typed-delay-with-authored-age-curve") {
        const age =
          effective === MAX
            ? 0
            : Math.fround(Math.fround(time - original.delay) / effective);
        const rotation = values.sample(source.birthRotation0, age, [0, 0, 0]);
        exact(
          fl(s.births[0].birthHex, 0x5c),
          rotation[0],
          "original delayed authored birth curve uses effective age",
        );
        if (
          c.variant === "original-single-clock-rewrite" &&
          rotation[0] > 0 &&
          age > 0
        )
          meaningfulDelayedBirths++;
        birthCurveControls++;
      }
    }
  }
}
for (const seed of seeds) {
  const id = ["typed-delay-with-authored-age-curve", null, seed];
  id[1] = variants[0];
  const a = firstBirths.get(JSON.stringify(id));
  id[1] = variants[1];
  const b = firstBirths.get(JSON.stringify(id));
  if (!a || !b || a === b || fl(a, 0x5c) !== 0 || !(fl(b, 0x5c) > 0))
    throw Error("Nontrivial authored age-curve counterexample required");
}
if (
  frames !== 488 ||
  controllerSteps !== 488 ||
  births !== 8 ||
  birthCurveControls !== 4 ||
  meaningfulDelayedBirths !== 2
)
  throw Error("Complete observable single-clock paired proof required");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Final link evidence drift");
const output = `${cache}/research/direct-link-controllers-comparison.json`,
  counts = {
    emptyProducerControls: native.controls.length,
    scalarClockControls: native.singleClocks.length,
    frames,
    controllerSteps,
    births,
    birthCurveControls,
    meaningfulDelayedBirths,
    rejectedCorruptMatrices: rejects,
  };
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "direct-empty-link-single-clock-comparison",
      counts,
      inputs,
      scope: {
        emptyMaterialOverrideCountProven: true,
        singleEffectiveLifetimeAndEmitterAgeProven: true,
        preRewriteLinkTimersPreserved: true,
        fullResourcePostloadExecuted: false,
        nativeWorldAcceptance: false,
        runtimeIntegrated: false,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ output, counts, pass: true }));
