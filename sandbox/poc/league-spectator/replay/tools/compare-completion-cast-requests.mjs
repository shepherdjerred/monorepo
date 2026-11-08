import { resolve } from "node:path";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";
import { createPresentationMissileActors } from "../latest-presentation-missile-actors.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Completion input changed: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(
  `${cache}/research/cast-on-movement-complete-native.json`,
);
if (
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.kind !== "original-cast-on-movement-complete-local-controls" ||
  native.scope.originalCastDispatcherExecuted !== false
)
  throw Error("Matching scoped original completion-action controls required");
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Completion native producer changed: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Completion native image changed");
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
    block.sha256
  )
    throw Error("Original completion behavior instructions differ");
const definitionBytes = await raw(
    `${cache}/public/decoder-16.21-macos/missile-actors.json`,
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
if ((await sha256(definitionBytes)) !== profile.missileActorsSha256)
  throw Error("Shared actor package changed");
const actors = createPresentationMissileActors(
  createLatestMissileActors(
    JSON.parse(new TextDecoder().decode(definitionBytes)),
  ),
);
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-presentation-missile-actors.mjs"),
  resolve(import.meta.dir, "../latest-missile-actors.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(path);
const hex = (v) => new Uint8Array(new Float32Array(v).buffer).toHex();
const mismatches = [];
let operations = 0,
  requests = 0;
for (const [index, c] of native.cases.entries()) {
  const record = {
    entityId: index + 1,
    pendingChildren: 0,
    replicationPhase: 0,
    cast: { targetCount: 0 },
    behaviorSpecs: c.componentOrder.map((kind) => ({
      __type:
        kind === "cast"
          ? "CastOnMovementComplete"
          : "DestroyOnMovementComplete",
    })),
  };
  const state = actors.initialize(record, c.suppliedVelocity, {
    instanceId: `native-control:${index}`,
    sourceEventId: `source:${index}`,
  });
  const check = (expected, tick) => {
    const actualComponents = state.components.map((component) => ({
      actionVtableRva:
        component.type === "CastOnMovementComplete" ? 0x235c610 : 0x235c648,
      remainingDelay: component.remainingDelay,
      fired: component.fired,
      actionExecuted: component.actionExecuted,
    }));
    if (
      state.phase !== expected.phase ||
      state.phaseLatch !== expected.phaseLatch ||
      state.stopped !== expected.stopped ||
      hex(state.velocity) !== expected.velocityHex ||
      state.presentationStopCalls !== expected.stopPresentationCalls ||
      JSON.stringify(actualComponents) !==
        JSON.stringify(expected.components) ||
      state.castRequests.length !== expected.castRequests.length ||
      state.castRequests.some(
        (request, i) =>
          hex(request.normalizedDirection) !==
            expected.castRequests[i].directionHex ||
          request.phase !== expected.castRequests[i].phase ||
          request.rendered !== false,
      )
    )
      mismatches.push({ index, tick, state, expected });
    if (
      new Set(state.castRequests.map((request) => request.id)).size !==
      state.castRequests.length
    )
      throw Error("Repeated completion actions lost their generated identity");
  };
  check(c.initial, -1);
  for (const [tick, operation] of c.operations.entries()) {
    if (operation.operation === "phase") actors.advancePhase(state, tick);
    else actors.componentFrame(state, operation.operation === "frame-arrived");
    check(operation.state, tick);
    operations++;
  }
  requests += state.castRequests.length;
}
const report = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  kind: "completion-cast-request-local-comparison",
  inputs,
  cases: native.cases.length,
  operations,
  emittedRequests: requests,
  mismatches,
  scope: {
    originalLocalBehaviorAndNormalizationCompared: true,
    downstreamOriginalCastDispatcherImplemented: false,
    childSpellPresentationRendered: false,
    actualPlaybackClockRecovered: false,
  },
};
const output = `${cache}/research/completion-cast-requests-comparison.json`;
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    cases: report.cases,
    operations,
    emittedRequests: requests,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
