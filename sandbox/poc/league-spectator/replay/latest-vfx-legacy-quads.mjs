import { NativeVfxSpawnKernel } from "./latest-vfx-spawn.mjs";
import { emitterPreviewMath } from "./latest-vfx-emitter.mjs";
import { sha256 } from "./structural-comparison.mjs";

const geometryAddresses = {
  context: 0x10030000,
  view: 0x10031000,
  draw: 0x10032000,
  indices: 0x10040000,
  vertices: 0x10080000,
};
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
const unhex = (value) => {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/.test(value))
    throw Error("Invalid legacy quad bytes");
  return Uint8Array.from(value.match(/../g) ?? [], (n) => parseInt(n, 16));
};
const hex = (bytes) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
const finite = (n) => typeof n === "number" && Number.isFinite(Math.fround(n));
const vector = (v, width) =>
  Array.isArray(v) && v.length === width && v.every(finite);
const checkpointLayout = {
  ownedAddress: 0x10020000,
  ownedBytes: 0x10000,
  heapAddress: 0x10400000,
  heapLimit: 0x12000000,
  globals: [{ rva: 0x2516698, bytes: 8 }],
};
async function admitGraph(bytes, meta, addresses) {
  const graph = decode(bytes),
    digest = await sha256(bytes),
    ref = meta.templates.find((t) => t.sha256 === digest);
  if (
    !ref ||
    graph.schema !== 1 ||
    graph.build !== meta.build ||
    graph.protocol !== meta.protocol ||
    graph.effectId !== ref.effectId ||
    graph.emitterIndex !== ref.emitterIndex ||
    graph.sourceDefinitionSha256 !== ref.sourceDefinitionSha256 ||
    JSON.stringify(graph.addresses) !== JSON.stringify(addresses)
  )
    throw Error("Unadmitted legacy quad graph");
  return { graph, ref };
}

export async function createLatestVfxLegacyQuads(
  uc,
  profile,
  image,
  spawnBytes,
  emitterBytes,
  definitionBytes,
  graphBytes,
  math = emitterPreviewMath,
) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(emitterBytes)) !== profile.vfxEmitterSha256 ||
    (await sha256(definitionBytes)) !== profile.vfxLegacyQuadsSha256
  )
    throw Error("Legacy quad package integrity mismatch");
  const meta = decode(definitionBytes),
    spawn = decode(spawnBytes),
    emitter = decode(emitterBytes),
    graph = decode(graphBytes),
    digest = await sha256(graphBytes),
    ref = meta.templates.find((t) => t.sha256 === digest);
  if (
    !ref ||
    meta.schema !== 1 ||
    graph.schema !== 1 ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    meta.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.vfxEmitterSha256 !== profile.vfxEmitterSha256 ||
    meta.vfxQuadVerticesSha256 !== profile.vfxQuadVerticesSha256 ||
    emitter.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    spawn.vfxBirthSha256 !== profile.vfxBirthSha256 ||
    spawn.vfxValuesSha256 !== profile.vfxValuesSha256 ||
    spawn.decoderImageSha256 !== profile.decoderImageSha256 ||
    emitter.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.frameRva !== 0x1757f10 ||
    meta.writerRva !== 0x1730410 ||
    meta.maximumParticles !== 1024 ||
    meta.uvScratchAddress !== 0x1002f000 ||
    JSON.stringify(meta.checkpointLayout) !==
      JSON.stringify(checkpointLayout) ||
    meta.shapeConstructorRva !== 0x17951d0 ||
    meta.primitiveConstructorRva !== 0x17a6390 ||
    JSON.stringify(meta.geometryAddresses) !==
      JSON.stringify(geometryAddresses) ||
    graph.build !== meta.build ||
    graph.protocol !== meta.protocol ||
    graph.effectId !== ref.effectId ||
    graph.emitterIndex !== ref.emitterIndex ||
    graph.sourceDefinitionSha256 !== ref.sourceDefinitionSha256 ||
    JSON.stringify(graph.addresses) !== JSON.stringify(spawn.addresses) ||
    ![
      "sincosf",
      "sinf",
      "cosf",
      "sqrtf",
      "acosf",
      "atan2f",
      "fmodf",
      "powf",
      "expf",
      "modff",
    ].every((n) => typeof math?.[n] === "function")
  )
    throw Error("Unsupported legacy quad runtime/graph");
  const kernel = new NativeVfxSpawnKernel(
    uc,
    profile,
    image,
    spawn,
    graph,
    math,
  );
  kernel.enableEmitterMath();
  return new NativeQuadRuntime(kernel, meta);
}

// Shared low-level quad execution. Admission factories validate shape-specific
// packages before constructing this runtime.
export class NativeQuadRuntime {
  #graphs = new WeakMap();
  #checkpoints = new WeakMap();
  constructor(kernel, metadata) {
    this.kernel = kernel;
    this.metadata = metadata;
  }
  async loadGraph(bytes) {
    if (this.closed) throw Error("Legacy quad component is closed");
    const { graph, ref } = await admitGraph(
      bytes,
      this.metadata,
      this.kernel.a,
    );
    if (this.closed)
      throw Error("Legacy quad component closed while loading a graph");
    const handle = Object.freeze({
      graphSha256: ref.sha256,
      effectId: ref.effectId,
      emitterIndex: ref.emitterIndex,
    });
    this.#graphs.set(handle, graph);
    return handle;
  }
  selectGraph(handle) {
    const graph = this.#graphs.get(handle);
    if (this.closed || !graph)
      throw Error("Unknown or foreign legacy quad graph");
    this.kernel.graph = graph;
    this.ready = false;
  }
  checkpoint() {
    if (!this.ready || this.closed)
      throw Error("Legacy quad checkpoint requires initialized state");
    const k = this.kernel,
      l = checkpointLayout,
      heapBytes = k.nextHeap - l.heapAddress;
    if (
      !Number.isSafeInteger(heapBytes) ||
      heapBytes < 0 ||
      k.nextHeap > l.heapLimit
    )
      throw Error("Invalid legacy quad checkpoint heap");
    const saved = {
      graph: k.graph,
      owned: k.read(l.ownedAddress, l.ownedBytes),
      heap: k.read(l.heapAddress, heapBytes),
      globals: l.globals.map((v) => k.read(k.base + v.rva, v.bytes)),
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
        saved.globals.reduce((n, v) => n + v.length, 0),
    });
    this.#checkpoints.set(handle, saved);
    return handle;
  }
  restore(handle) {
    const saved = this.#checkpoints.get(handle);
    if (this.closed || !saved)
      throw Error("Unknown, released or foreign legacy quad checkpoint");
    const k = this.kernel,
      l = checkpointLayout;
    k.engine.mem_write(l.ownedAddress, saved.owned);
    k.engine.mem_write(l.heapAddress, saved.heap);
    l.globals.forEach((v, i) =>
      k.engine.mem_write(k.base + v.rva, saved.globals[i]),
    );
    k.graph = saved.graph;
    k.nextHeap = saved.nextHeap;
    k.allocations = new Map(saved.allocations);
    k.poolSize = saved.poolSize;
    k.births = [];
    k.services = {};
    k.mathCalls = [];
    this.lastTime = saved.lastTime;
    this.ready = true;
  }
  releaseCheckpoint(handle) {
    if (this.closed || !this.#checkpoints.delete(handle))
      throw Error("Unknown, released or foreign legacy quad checkpoint");
  }
  reset(seed, quality) {
    if (this.closed || ![0, 1, 2, 3].includes(quality))
      throw Error("Explicit legacy quad quality required");
    const k = this.kernel,
      a = k.a;
    k.reset(seed);
    if (k.read(a.definition + 0x17, 1)[0] >= 6)
      throw Error("Unadmitted legacy quad importance");
    k.put(a.system + 0x1c8, [1]);
    k.put(a.manager + 0x284, [1, 1, 1, 1, 1, 1]);
    k.put(a.manager + 0x29c, [quality], "u32");
    k.u64(a.link + 8, a.resource);
    k.callNative(0x14896f0, { RDI: a.systemDefinition + 0x100 });
    for (const value of this.metadata.initializedGlobals)
      k.engine.mem_write(k.base + value.rva, unhex(value.bytesHex));
    this.lastTime = -Infinity;
    this.ready = true;
  }
  frame(input) {
    this.advance(input);
    return {
      state: this.readState(),
      geometry: this.renderGeometry(input.viewPosition),
    };
  }
  readState() {
    if (!this.ready || this.closed)
      throw Error("Legacy quad state requires initialized component");
    const state = this.kernel.snapshot();
    if (state.vectors.life.count > this.metadata.maximumParticles)
      throw Error("Legacy quad pool limit");
    return state;
  }
  advance(input) {
    if (
      !this.ready ||
      this.closed ||
      !finite(input.time) ||
      input.time < 0 ||
      input.time > 30 ||
      input.time < this.lastTime ||
      ![input.previous, input.current, input.viewPosition].every((v) =>
        vector(v, 3),
      ) ||
      !vector(input.basis, 16)
    )
      throw Error("Unsupported legacy quad frame input");
    const k = this.kernel,
      a = k.a;
    this.lastTime = input.time;
    k.births = [];
    k.mathCalls = [];
    k.services = {};
    k.put(a.system + 0xfc, input.previous);
    k.put(a.system + 0x108, input.current);
    k.put(a.system + 0x1e0, input.basis);
    k.engine.mem_write(a.stack - 0x8000, new Uint8Array(0x8000));
    k.callNative(this.metadata.frameRva, { RDI: a.actor }, null, {
      XMM0: input.time,
    });
  }
  renderGeometry(viewPosition, uv = null) {
    if (
      !this.ready ||
      this.closed ||
      !vector(viewPosition, 3) ||
      (uv !== null &&
        (typeof uv.multBound !== "boolean" ||
          !["base", "mult"].every((n) => uv[n] === null || vector(uv[n], 6))))
    )
      throw Error("Invalid legacy quad render inputs");
    const k = this.kernel,
      a = k.a,
      g = geometryAddresses,
      pool = k.q(a.actor + 0xa0),
      count = k.readU32(pool + 0x10);
    if (count > this.metadata.maximumParticles)
      throw Error("Legacy quad pool limit");
    if (uv !== null && count > 1)
      throw Error("Single-particle UV composition required");
    const scratch = this.metadata.uvScratchAddress,
      saved =
        uv === null
          ? null
          : {
              scratch: k.read(scratch, 64),
              flags: k.read(a.link + 0xe8, 2),
              mult: k.q(a.link + 0x58),
              basePointer: k.q(pool + 0x78),
              multPointer: k.q(pool + 0x88),
            };
    try {
      if (uv !== null) {
        for (const [key, offset, flag] of [
          ["base", 0, 0xe8],
          ["mult", 32, 0xe9],
        ]) {
          if (uv[key] !== null) k.put(scratch + offset, uv[key]);
          k.u64(pool + (key === "base" ? 0x78 : 0x88), scratch + offset);
          k.put(a.link + flag, [uv[key] === null ? 0 : 1], "u8");
        }
        k.u64(a.link + 0x58, uv.multBound ? a.primitive : 0);
      }
      k.engine.mem_write(g.context, new Uint8Array(0x3000));
      for (const [offset, pointer] of [
        [0, g.indices],
        [8, g.vertices],
        [0x10, g.draw],
        [0x18, a.actor],
        [0x20, g.view],
      ])
        k.u64(g.context + offset, pointer);
      k.put(g.view, viewPosition);
      k.mathCalls = [];
      k.callNative(this.metadata.writerRva, {
        RDI: a.primitive,
        RSI: g.context,
      });
      const nv = k.q(g.context + 8) - g.vertices,
        ni = k.q(g.context) - g.indices;
      if (nv !== count * 112 || ni !== count * 12)
        throw Error("Legacy quad output limit");
      return {
        verticesHex: hex(k.read(g.vertices, nv)),
        indicesHex: hex(k.read(g.indices, ni)),
        drawHex: hex(k.read(g.draw, 16)),
        mathCalls: [...k.mathCalls],
      };
    } finally {
      if (saved) {
        k.engine.mem_write(scratch, saved.scratch);
        k.engine.mem_write(a.link + 0xe8, saved.flags);
        k.u64(a.link + 0x58, saved.mult);
        k.u64(pool + 0x78, saved.basePointer);
        k.u64(pool + 0x88, saved.multPointer);
      }
    }
  }
  close() {
    if (!this.closed) this.kernel.close();
    this.closed = true;
    this.ready = false;
    this.#graphs = new WeakMap();
    this.#checkpoints = new WeakMap();
  }
}
