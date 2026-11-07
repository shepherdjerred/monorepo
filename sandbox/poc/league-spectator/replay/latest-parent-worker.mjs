// Complete parent CPU context in one module worker. Static assets only over HTTP.
import { createLatestBulkUnicorn } from "./latest-unicorn-bulk.mjs";
import {
  createLatestParentFrames,
  PARENT_REQUESTED_CACHES_SHA,
  PARENT_RAY_CACHES_SHA,
  PARENT_DRAW_CACHES_SHA,
} from "./latest-parent-frames.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { LatestParentMissileTimeline } from "./latest-parent-missile-timeline.mjs";

let runtime,
  failed,
  closed = false,
  lastRequest = 0,
  nextParent = 1,
  nextCheckpoint = 1;
let parents = new Map();
let timeline;
const checkpoints = new Map();
const owned = (id) => {
  if (!Number.isSafeInteger(id) || !parents.has(id))
    throw Error("Unowned worker parent");
  return parents.get(id);
};
const load = (base) => async (file) => {
  if (typeof file !== "string" || !/^[a-z0-9-]+\.(?:json|bin)$/.test(file))
    throw Error("Invalid parent worker asset filename");
  const response = await fetch(new URL(file, base));
  if (response.status !== 200)
    throw Error(`Parent static asset HTTP ${response.status}: ${file}`);
  return new Uint8Array(await response.arrayBuffer());
};
async function processRequest(type, payload) {
  if (type === "dispose") {
    timeline?.close();
    runtime?.close();
    closed = true;
    parents.clear();
    checkpoints.clear();
    return null;
  }
  if (closed || failed) throw Error("Parent worker is closed or failed");
  if (type === "init") {
    if (runtime || !payload || !payload.options)
      throw Error("Invalid or repeated parent worker initialization");
    const assetBase = new URL(payload.assetBase),
      moduleUrl = new URL(payload.runtimeModuleUrl);
    if (
      !["http:", "https:"].includes(assetBase.protocol) ||
      !assetBase.pathname.endsWith("/assets/") ||
      !["http:", "https:", "file:"].includes(moduleUrl.protocol) ||
      !moduleUrl.pathname.endsWith("/vendor/unicorn_x86_candidate.mjs")
    )
      throw Error("Invalid parent worker static asset/module location");
    const { default: factory } = await import(moduleUrl.href),
      options = payload.options;
    const uc = await createLatestBulkUnicorn(
      factory,
      options.runtimeBytes,
      options.bulkPackageBytes,
      options.bulkWasmBytes,
    );
    const catalogDigest = await sha256(options.cachePackageBytes);
    runtime = await createLatestParentFrames({
      ...options,
      uc,
      loadBytes: load(
        new URL(
          catalogDigest === PARENT_DRAW_CACHES_SHA
            ? "latest-parent-draw-caches/"
            : catalogDigest === PARENT_RAY_CACHES_SHA
              ? "latest-ray-parent-caches/"
              : catalogDigest === PARENT_REQUESTED_CACHES_SHA
                ? "latest-effect-root-frame-caches/"
                : "latest-parent-frame-caches/",
          assetBase,
        ),
      ),
      loadMathBytes: load(new URL("latest-parent-math/", assetBase)),
    });
    return {
      effectId: runtime.cache.effectId,
      build: runtime.abi.build,
      protocol: runtime.abi.protocol,
    };
  }
  if (!runtime) throw Error("Parent worker is not initialized");
  if (type === "timeline") {
    if (timeline || parents.size || checkpoints.size)
      throw Error("Parent timeline requires exclusive worker ownership");
    timeline = new LatestParentMissileTimeline(runtime, payload.traces);
    return timeline.summary();
  }
  if (type === "sample") {
    if (!timeline) throw Error("Parent timeline is not initialized");
    return timeline.sample(payload.time, payload.camera);
  }
  if (timeline && type !== "world")
    throw Error("Manual parent commands cannot mutate a timeline worker");
  if (type === "create") {
    const handle = runtime.createParent(payload),
      id = nextParent++;
    parents.set(id, handle);
    return {
      id,
      ownership: runtime.ownership(handle),
      ...(payload.placement === undefined
        ? {}
        : { placement: runtime.initialPlacement(handle) }),
    };
  }
  if (type === "suspend")
    return runtime.suspend(owned(payload.id), payload.suspended);
  if (type === "checkpoint") {
    const id = nextCheckpoint++,
      token = runtime.checkpoint();
    checkpoints.set(id, { token, parents: new Map(parents) });
    return { id };
  }
  if (["restore", "release"].includes(type)) {
    const saved = checkpoints.get(payload.id);
    if (!saved) throw Error("Unowned worker checkpoint");
    if (type === "release") {
      runtime.releaseCheckpoint(saved.token);
      checkpoints.delete(payload.id);
      return null;
    }
    runtime.restore(saved.token);
    parents = new Map(saved.parents);
    return { parents: [...parents.keys()] };
  }
  if (type === "inspect")
    return {
      ownership: runtime.ownership(owned(payload.id)),
      state: runtime.state(owned(payload.id)),
    };
  if (type === "world") return runtime.worldState();
  if (type === "drawParameters")
    return runtime.drawParameters(
      owned(payload.id),
      payload.emitterIndex,
      payload.inputs,
      payload.options,
    );
  if (type === "render")
    return {
      id: payload.id,
      geometry: runtime.render(owned(payload.id), payload.camera, {
        binary: true,
      }),
    };
  if (type !== "frame") throw Error("Unknown parent worker command");
  const { updates, camera, captureState } = payload;
  if (
    !Array.isArray(updates) ||
    !updates.length ||
    typeof captureState !== "boolean" ||
    updates.length !== parents.size ||
    new Set(updates.map((u) => u.id)).size !== updates.length
  )
    throw Error("Parent frame must cover every live parent once");
  if (
    !updates.every(
      (u) =>
        Number.isFinite(u.time) &&
        Math.fround(u.time) === Math.fround(updates[0].time),
    )
  )
    throw Error("Parent frame requires one shared finite world time");
  // Check ownership before mutating any parent. Updates retain caller order:
  // it is an explicit input to consumption of the context's shared RNG stream.
  for (const update of updates) owned(update.id);
  const results = [];
  for (const update of updates) {
    const handle = owned(update.id);
    if (Object.hasOwn(update, "suspended"))
      runtime.suspend(handle, update.suspended);
    const placement = Object.hasOwn(update, "placement")
      ? runtime.setPlacement(handle, update.placement, { captureState })
      : undefined;
    const step = runtime.advance(handle, update.time, update.maxSubsteps, {
      captureState,
    });
    results.push({
      id: update.id,
      ...step,
      ...(placement === undefined ? {} : { placement }),
    });
  }
  for (const result of results)
    result.geometry = runtime.render(owned(result.id), camera, {
      binary: true,
    });
  return { camera, parents: results };
}

function buffers(value, result = new Set()) {
  if (value instanceof Uint8Array) result.add(value.buffer);
  else if (Array.isArray(value))
    for (const child of value) buffers(child, result);
  else if (value && typeof value === "object")
    for (const child of Object.values(value)) buffers(child, result);
  return result;
}
let queue = Promise.resolve();
globalThis.onmessage = ({ data }) => {
  if (
    !data ||
    data.version !== 1 ||
    !Number.isSafeInteger(data.id) ||
    data.id <= lastRequest ||
    typeof data.type !== "string"
  ) {
    failed = Error("Invalid parent worker protocol envelope");
    postMessage({
      version: 1,
      fatal: { name: failed.name, message: failed.message },
    });
    return;
  }
  lastRequest = data.id;
  queue = queue.then(async () => {
    try {
      const result = await processRequest(data.type, data.payload);
      postMessage({ version: 1, id: data.id, ok: true, result }, [
        ...buffers(result),
      ]);
    } catch (error) {
      failed = error instanceof Error ? error : new Error(String(error));
      postMessage({
        version: 1,
        id: data.id,
        ok: false,
        error: { name: failed.name, message: failed.message },
      });
    }
  });
};
