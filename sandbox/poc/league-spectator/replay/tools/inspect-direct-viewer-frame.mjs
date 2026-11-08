// Execute the actual viewer frame function with controlled async worker/DOM
// boundaries. This is a CLI clock/control proof, not browser or GPU execution.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  viewer = resolve(import.meta.dir, "../latest-viewer.mjs"),
  inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
};
const source = new TextDecoder("utf-8", { fatal: true }).decode(
  await raw(viewer),
);
await raw(import.meta.path);
await raw(resolve(import.meta.dir, "../structural-comparison.mjs"));
const opening = "async function frame(now) {",
  ending = "\nrequestAnimationFrame(frame);";
const start = source.indexOf(opening),
  end = source.indexOf(ending, start);
assert(
  start >= 0 && source.indexOf(opening, start + 1) < 0 && end > start,
  "Unique actual frame boundaries required",
);
const frameSource = source.slice(start, end).trim();
assert(frameSource.endsWith("}"), "Complete actual frame function required");
const install = new Function("scope", `with(scope){return (${frameSource});}`);
let checks = 0;
function fixture() {
  const calls = {
      requests: [],
      commits: [],
      draws: [],
      world: [],
      raf: [],
      errors: [],
    },
    nodes = new Map();
  const effects = {
    ready: true,
    enabled: true,
    group: { visible: false },
    commitDirect(packet, view) {
      calls.commits.push({ time: packet.time, camera: view.id });
    },
  };
  let requestId = 0,
    current = 0;
  const session = {
    renderer: effects,
    requestPresentation(time, view) {
      const id = ++requestId;
      current = id;
      return new Promise((resolve, reject) =>
        calls.requests.push({
          id,
          time,
          camera: view.id,
          resolve: () => resolve({ time, requestId: id, packet: { time } }),
          reject,
        }),
      );
    },
    isPresentationCurrent(result) {
      return result.requestId === current;
    },
  };
  const scope = {
    diagnosticFrame: null,
    worldUpdateAndHudMs: 0,
    effectCommitMs: 0,
    previous: 0,
    time: 69,
    presentedTime: 69,
    playing: true,
    speed: 1,
    preparedEffects: { frames: [] },
    preparingEffectPreview: false,
    report: { endTime: 100, replaySha256: "a".repeat(64) },
    vfxRenderer: effects,
    directEffectSession: session,
    camera: {
      id: 1,
      aspect: 1,
      clone() {
        return { id: this.id, aspect: this.aspect };
      },
    },
    controls: { update() {} },
    performance: { now: () => 5000 },
    effectLookahead: null,
    cameraInteracting: false,
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, { textContent: "" });
      return nodes.get(id);
    },
    applyWorldTime() {
      calls.world.push(scope.time);
    },
    drawScene(view, mode) {
      calls.draws.push({
        time: scope.time,
        presentedTime: scope.presentedTime,
        camera: view.id,
        mode,
      });
    },
    particleStatus: () => "partial",
    fail: (error) => calls.errors.push(String(error)),
    requestAnimationFrame: (fn) => calls.raf.push(fn),
    captureEffectCameraPath() {
      throw Error("Legacy lookahead reached ordinary direct playback");
    },
  };
  return {
    scope,
    calls,
    frame: install(scope),
    nodes,
    invalidate: () => {
      current++;
    },
  };
}
async function complete(f, now, before = () => {}) {
  const count = f.calls.requests.length,
    run = f.frame(now);
  assert.equal(f.calls.requests.length, count + 1);
  before(f.calls.requests.at(-1));
  f.calls.requests.at(-1).resolve();
  await run;
  assert.equal(f.scope.diagnosticFrame, null);
  checks++;
}
const clock = fixture();
let pending = clock.frame(1000);
assert.equal(clock.calls.requests[0].time, 70);
assert.equal(clock.calls.raf.length, 0);
assert.equal(clock.calls.draws.length, 0);
clock.calls.requests[0].resolve();
await pending;
assert.equal(clock.calls.raf.length, 1);
assert.deepEqual(clock.calls.draws[0], {
  time: 70,
  presentedTime: 70,
  camera: 1,
  mode: "shared effects",
});
checks++;
await complete(clock, 1500);
assert.equal(clock.scope.time, 70.5);
clock.scope.speed = 4;
await complete(clock, 2000);
assert.equal(clock.scope.time, 72.5);
checks++;
clock.scope.playing = false;
clock.scope.camera.id = 2;
await complete(clock, 3000);
assert.equal(clock.scope.time, 72.5);
assert.equal(clock.calls.draws.at(-1).camera, 2);
checks++;
const seek = fixture();
pending = seek.frame(1000);
seek.scope.time = 80;
seek.scope.presentedTime = 80;
seek.calls.requests[0].resolve();
await pending;
assert.equal(seek.calls.commits.length, 0);
assert.equal(seek.calls.draws.length, 0);
assert.equal(seek.calls.raf.length, 1);
await complete(seek, 1250);
assert.equal(seek.scope.time, 80.25);
checks++;
const replay = fixture();
pending = replay.frame(1000);
const replacement = { endTime: 50, replaySha256: "b".repeat(64) };
replay.scope.report = replacement;
replay.scope.directEffectSession = {};
replay.scope.time = 12;
replay.calls.requests[0].reject(
  new DOMException("Discarded replay", "AbortError"),
);
await pending;
assert.equal(replay.scope.report, replacement);
assert.equal(replay.scope.time, 12);
assert.equal(replay.calls.errors.length, 0);
assert.equal(replay.calls.raf.length, 1);
checks++;
const superseded = fixture();
await complete(superseded, 1000, () => superseded.invalidate());
assert.equal(superseded.calls.commits.length, 0);
assert.equal(superseded.calls.draws.length, 0);
checks++;
const disabled = fixture();
disabled.scope.vfxRenderer.enabled = false;
await disabled.frame(1000);
assert.equal(disabled.calls.requests.length, 0);
assert.equal(disabled.scope.time, 70);
assert.equal(disabled.calls.draws.length, 1);
assert.equal(disabled.calls.raf.length, 1);
checks++;
const off = fixture();
await complete(off, 1000, () => {
  off.scope.vfxRenderer.enabled = false;
});
assert.equal(off.calls.commits.length, 0);
assert.equal(off.scope.vfxRenderer.group.visible, false);
assert.equal(off.calls.draws.length, 1);
checks++;
const resized = fixture();
await complete(resized, 1000, () => {
  resized.scope.camera.aspect = 2;
});
assert.equal(resized.calls.commits.length, 0);
assert.equal(resized.calls.draws.length, 0);
checks++;
const camera = fixture();
await complete(camera, 1000, () => {
  camera.scope.camera.id = 99;
});
assert.equal(camera.calls.commits[0].camera, 1);
assert.equal(camera.calls.draws[0].camera, 1);
checks++;
const endClock = fixture();
endClock.scope.time = 99;
endClock.scope.speed = 4;
await complete(endClock, 1000);
assert.equal(endClock.scope.time, 100);
assert.equal(endClock.scope.playing, false);
assert.equal(endClock.nodes.get("play").textContent, "Play");
checks++;
const failed = fixture();
pending = failed.frame(1000);
failed.calls.requests[0].reject(Error("Owned worker failure"));
await pending;
assert.equal(failed.scope.report, null);
assert.match(failed.calls.errors[0], /Owned worker failure/);
assert.equal(failed.calls.raf.length, 1);
checks++;
for (const f of [clock, seek, replay, off, resized, camera, endClock, failed])
  assert(f.calls.raf.every((fn) => typeof fn === "function"));
for (const [path, digest] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    digest,
    `Frame source changed:${path}`,
  );
const result = {
  schema: 1,
  kind: "actual-viewer-frame-function-cli-control",
  inputs,
  frameSourceSha256: await sha256(new TextEncoder().encode(frameSource)),
  checks,
  controls: {
    entireAwaitedWallIntervalRetained: true,
    speed1xAnd4x: true,
    pauseAndCamera: true,
    seekSupersedesPendingView: true,
    replayReplacementRejectionNonfatal: true,
    disabledWhilePendingCannotCommit: true,
    resizeSupersedesPendingView: true,
    coordinatorOwnershipSupersedesPendingView: true,
    disabledEffectsClockAdvancesWithoutWorker: true,
    capturedCameraSharedByCommitAndDraw: true,
    endTimeClampsAndPauses: true,
    ownedErrorsFailExplicitly: true,
    nextRafOnlyAfterAwait: true,
  },
  scope: {
    actualViewerFrameFunctionExecuted: true,
    fakeWorkerAndDom: true,
    actualBrowserExecuted: false,
    gpuSubmission: false,
    actualSpectatorAcceptance: false,
  },
};
const output = resolve(cache, "research/direct-viewer-frame-control.json");
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ output, checks, fingerprints: Object.keys(inputs).length }),
);
