import { createLatestVfxSpawn, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { sha256 } from "./structural-comparison.mjs";

export const emitterPreviewMath = {
  ...spawnPreviewMath,
  expf: (x) => Math.fround(Math.exp(x)),
  modff: (x) => {
    const integer = Math.trunc(x);
    return {
      integer: Math.fround(integer),
      fraction:
        x === integer
          ? x < 0 || Object.is(x, -0)
            ? -0
            : 0
          : Math.fround(x - integer),
    };
  },
};

export async function createLatestVfxEmitter(
  uc,
  profile,
  image,
  spawnBytes,
  graphBytes,
  emitterBytes,
  math,
) {
  if (
    !(
      emitterBytes instanceof ArrayBuffer || emitterBytes instanceof Uint8Array
    ) ||
    (await sha256(emitterBytes)) !== profile.vfxEmitterSha256
  )
    throw Error("Native emitter package hash mismatch");
  const metadata = JSON.parse(new TextDecoder().decode(emitterBytes));
  if (
    metadata.schema !== 1 ||
    metadata.build !== "16.21.829.8620" ||
    metadata.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== metadata.build ||
    profile.protocolDigest !== metadata.protocol ||
    metadata.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    metadata.vfxTrailsSha256 !== profile.vfxTrailsSha256 ||
    metadata.decoderImageSha256 !== profile.decoderImageSha256 ||
    metadata.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    metadata.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    metadata.frameRva !== 0x1757f10 ||
    metadata.writerRva !== 0x1737570 ||
    metadata.maximumPoints !== 1024 ||
    JSON.stringify(metadata.checkpointLayout) !==
      JSON.stringify({
        ownedAddress: 0x10020000,
        ownedBytes: 0x10000,
        heapAddress: 0x10400000,
        heapLimit: 0x12000000,
        globals: [{ rva: 0x2516698, bytes: 8 }],
      }) ||
    metadata.additionalMathImports._modff !== 0x1feea6e ||
    metadata.additionalMathImports._expf !== 0x1fee81c ||
    typeof math?.modff !== "function" ||
    typeof math?.expf !== "function"
  )
    throw Error("Unsupported native emitter contract");
  const kernel = await createLatestVfxSpawn(
    uc,
    profile,
    image,
    spawnBytes,
    graphBytes,
    math,
  );
  kernel.enableEmitterMath();
  return new Emitter(kernel, metadata);
}

class Emitter {
  #checkpoints = new WeakMap();
  constructor(kernel, metadata) {
    this.kernel = kernel;
    this.metadata = metadata;
  }
  reset(seed, smoothingQuality) {
    if (this.closed) throw Error("Native emitter is closed");
    if (![0, 1, 2, 3].includes(smoothingQuality))
      throw Error("Explicit smoothing quality required");
    const k = this.kernel,
      a = k.a;
    k.reset(seed);
    const importance = k.read(a.definition + 0x17, 1)[0];
    if (importance >= 6) throw Error("Unprepared emitter importance");
    k.put(a.system + 0x1c8, [1]);
    k.put(a.manager + 0x284, [1, 1, 1, 1, 1, 1]);
    k.put(a.manager + 0x29c, [smoothingQuality], "u32");
    k.u64(a.link + 8, a.resource);
    k.callNative(0x14896f0, { RDI: a.systemDefinition + 0x100 });
    for (const value of this.metadata.initializedGlobals)
      k.engine.mem_write(k.base + value.rva, unhex(value.bytesHex));
    this.lastTime = -Infinity;
    this.ready = true;
  }
  checkpoint() {
    if (!this.ready || this.closed)
      throw Error("Native emitter must be initialized before checkpointing");
    const k = this.kernel,
      layout = this.metadata.checkpointLayout,
      heapBytes = k.nextHeap - layout.heapAddress;
    if (
      !Number.isSafeInteger(heapBytes) ||
      heapBytes < 0 ||
      k.nextHeap > layout.heapLimit
    )
      throw Error("Invalid native emitter checkpoint heap");
    const saved = {
      owned: k.read(layout.ownedAddress, layout.ownedBytes),
      heap: k.read(layout.heapAddress, heapBytes),
      globals: layout.globals.map((value) =>
        k.read(k.base + value.rva, value.bytes),
      ),
      nextHeap: k.nextHeap,
      allocations: new Map(k.allocations),
      poolSize: k.poolSize,
      lastTime: this.lastTime,
    };
    const handle = Object.freeze({
      elapsedTime: this.lastTime === -Infinity ? null : this.lastTime,
      bytes:
        saved.owned.length +
        saved.heap.length +
        saved.globals.reduce((sum, value) => sum + value.length, 0),
    });
    this.#checkpoints.set(handle, saved);
    return handle;
  }
  restore(handle) {
    const saved = this.#checkpoints.get(handle);
    if (this.closed || !saved)
      throw Error("Unknown, released or foreign native emitter checkpoint");
    const k = this.kernel,
      layout = this.metadata.checkpointLayout;
    k.engine.mem_write(layout.ownedAddress, saved.owned);
    k.engine.mem_write(layout.heapAddress, saved.heap);
    layout.globals.forEach((value, index) =>
      k.engine.mem_write(k.base + value.rva, saved.globals[index]),
    );
    k.nextHeap = saved.nextHeap;
    k.allocations = new Map(saved.allocations);
    k.poolSize = saved.poolSize;
    k.births = [];
    k.mathCalls = [];
    k.services = {};
    this.lastTime = saved.lastTime;
    this.ready = true;
  }
  releaseCheckpoint(handle) {
    if (this.closed || !this.#checkpoints.delete(handle))
      throw Error("Unknown, released or foreign native emitter checkpoint");
  }
  frame(input) {
    if (
      !this.ready ||
      !finite(input.time) ||
      input.time < 0 ||
      input.time > 30 ||
      input.time < this.lastTime ||
      ![input.previous, input.current, input.viewForward].every(
        (v) => Array.isArray(v) && v.length === 3 && v.every(finite),
      ) ||
      Math.hypot(...input.viewForward) < 0.0001
    )
      throw Error("Unsupported native emitter frame input");
    this.lastTime = input.time;
    const k = this.kernel,
      a = k.a,
      e = k.engine;
    k.births = [];
    k.services = {};
    k.mathCalls = [];
    k.put(a.system + 0xfc, input.previous);
    k.put(a.system + 0x108, input.current);
    e.mem_write(a.stack - 0x8000, new Uint8Array(0x8000));
    k.callNative(this.metadata.frameRva, { RDI: a.actor }, null, {
      XMM0: input.time,
    });
    const state = k.snapshot();
    return { state, geometry: this.renderGeometry(input.viewForward) };
  }
  renderGeometry(viewForward) {
    if (
      !this.ready ||
      this.closed ||
      !Array.isArray(viewForward) ||
      viewForward.length !== 3 ||
      !viewForward.every(finite) ||
      Math.hypot(...viewForward) < 0.0001
    )
      throw Error("Unsupported emitter geometry view");
    const k = this.kernel,
      a = k.a,
      g = this.metadata.geometryAddresses,
      e = k.engine,
      count = k.readU32(k.q(a.actor + 0xa0) + 0x10);
    if (count > this.metadata.maximumPoints)
      throw Error("Emitter pool exceeds geometry limit");
    e.mem_write(g.context, new Uint8Array(0x3000));
    for (const [offset, pointer] of [
      [0, g.indices],
      [8, g.vertices],
      [0x10, g.draw],
      [0x18, a.actor],
      [0x20, g.view],
    ])
      k.u64(g.context + offset, pointer);
    k.put(g.view + 0x24, viewForward);
    k.mathCalls = [];
    k.callNative(this.metadata.writerRva, { RDI: a.primitive, RSI: g.context });
    const nv = k.q(g.context + 8) - g.vertices,
      ni = k.q(g.context) - g.indices;
    if (
      nv < 0 ||
      nv > count * 56 ||
      ni < 0 ||
      ni > Math.max(count - 1, 0) * 12 ||
      nv % 28 ||
      ni % 2
    )
      throw Error("Emitter geometry outside owned output");
    return {
      vertices: k.read(g.vertices, nv),
      indices: k.read(g.indices, ni),
      draw: k.read(g.draw, 16),
      mathCalls: k.mathCalls,
    };
  }
  close() {
    if (!this.closed) this.kernel.close();
    this.closed = true;
    this.ready = false;
    this.#checkpoints = new WeakMap();
  }
}
const finite = (value) =>
  Number.isFinite(value) && Number.isFinite(Math.fround(value));
const unhex = (value) => {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/.test(value))
    throw Error("Invalid emitter initialization bytes");
  return Uint8Array.from(value.match(/../g) ?? [], (x) => parseInt(x, 16));
};
