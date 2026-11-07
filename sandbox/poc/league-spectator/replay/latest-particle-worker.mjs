// One owned native pool runtime per worker. Match state stays in this browser.
import { createLatestBulkUnicorn } from "./latest-unicorn-bulk.mjs";
import { createLatestQuadPoolPlayback } from "./latest-quad-pool-playback.mjs";
import { createLatestTrailPlayback } from "./latest-trail-playback.mjs";

let runtime,
  traces,
  assetBase,
  kind,
  failed,
  closed = false;
const bindings = new Map();
async function processRequest(type, payload) {
  if (type === "close") {
    runtime?.close();
    closed = true;
    return null;
  }
  if (closed || failed) throw Error("Particle worker is closed or failed");
  if (type === "init") {
    if (
      runtime ||
      !["quad", "trail"].includes(payload.kind) ||
      !Array.isArray(payload.traces)
    )
      throw Error("Invalid or repeated particle worker initialization");
    kind = payload.kind;
    traces = payload.traces;
    assetBase = new URL(payload.assetBase);
    const moduleUrl = new URL(payload.runtimeModuleUrl);
    if (
      !["http:", "https:"].includes(assetBase.protocol) ||
      !assetBase.pathname.endsWith("/assets/") ||
      !["http:", "https:", "file:"].includes(moduleUrl.protocol) ||
      !moduleUrl.pathname.endsWith("/vendor/unicorn_x86_candidate.mjs")
    )
      throw Error("Invalid particle worker static asset/module location");
    const { default: factory } = await import(moduleUrl.href),
      options = payload.options;
    const uc = await createLatestBulkUnicorn(
      factory,
      options.runtimeBytes,
      options.bulkPackageBytes,
      options.bulkWasmBytes,
    );
    const directory =
      kind === "quad" ? "decoder-16.21-macos/" : "latest-trail-particles/";
    const loadGraphBytes = async (path) => {
      if (
        typeof path !== "string" ||
        path.startsWith("/") ||
        path.includes("..")
      )
        throw Error("Invalid worker particle graph path");
      const response = await fetch(new URL(directory + path, assetBase));
      if (response.status !== 200)
        throw Error(`Particle graph HTTP ${response.status}: ${path}`);
      return new Uint8Array(await response.arrayBuffer());
    };
    const create =
      kind === "quad"
        ? createLatestQuadPoolPlayback
        : createLatestTrailPlayback;
    runtime = await create({ ...options, uc, loadGraphBytes });
    return { policy: runtime.summary.policy };
  }
  if (!runtime) throw Error("Particle worker is not initialized");
  if (type === "bind") {
    const { effectId, emitterIndex, sourceDefinitionSha256 } = payload,
      key = `${effectId}:${emitterIndex}`;
    if (bindings.has(key)) throw Error("Duplicate worker particle binding");
    await runtime.bindEmitter(effectId, emitterIndex, sourceDefinitionSha256);
    bindings.set(key, { effectId, emitterIndex, sourceDefinitionSha256 });
    return null;
  }
  if (type !== "frame") throw Error("Unknown particle worker command");
  const { time, view } = payload;
  if (
    !Number.isFinite(time) ||
    !view ||
    !["position", "right", "up", "axis"].every(
      (k) =>
        Array.isArray(view[k]) &&
        view[k].length === 3 &&
        view[k].every(Number.isFinite),
    )
  )
    throw Error("Invalid worker particle frame inputs");
  runtime.beginFrame(time);
  const draws = [];
  let sampleCalls = 0;
  for (const trace of traces) {
    if (
      time < trace.startTime ||
      trace.stopTime === null ||
      (time > trace.stopTime && !trace.renderParticlesAfterDestroy)
    )
      continue;
    for (const binding of bindings.values()) {
      if (binding.effectId !== trace.effectId) continue;
      const sample = runtime.sample(trace, binding.emitterIndex, time, view);
      sampleCalls++;
      if (sample)
        draws.push({
          effectId: trace.effectId,
          sequence: trace.sequence,
          entityId: trace.entityId,
          emitterIndex: binding.emitterIndex,
          ...sample,
        });
    }
  }
  return { time, view, draws, sampleCalls };
}

// Serialize asynchronous init/binds and all later world mutations.
let queue = Promise.resolve();
globalThis.onmessage = ({ data }) => {
  if (
    !data ||
    data.version !== 1 ||
    !Number.isSafeInteger(data.id) ||
    data.id < 1 ||
    typeof data.type !== "string"
  ) {
    failed = Error("Invalid particle worker protocol envelope");
    postMessage({
      version: 1,
      fatal: { name: failed.name, message: failed.message },
    });
    return;
  }
  queue = queue.then(async () => {
    try {
      const result = await processRequest(data.type, data.payload);
      postMessage({ version: 1, id: data.id, ok: true, result });
    } catch (error) {
      failed = error;
      postMessage({
        version: 1,
        id: data.id,
        ok: false,
        error: { name: error.name, message: error.message },
      });
    }
  });
};
