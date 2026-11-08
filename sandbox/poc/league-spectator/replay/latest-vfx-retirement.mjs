// Exact-build parent scheduling and retirement through deferred disposal.
// Replay mode/clock binding, complete siblings and destruction remain separate.
import { sha256 } from "./structural-comparison.mjs";

const attached = new WeakSet();
const mutexImports = {
  _pthread_mutex_init: 0x1feebf4,
  _pthread_mutex_lock: 0x1feebfa,
  _pthread_mutex_unlock: 0x1feec06,
};
const hex = (bytes) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
const unhex = (value) =>
  Uint8Array.from(value.match(/../g) ?? [], (n) => parseInt(n, 16));
const finite = (v) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  Number.isFinite(Math.fround(v));
const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);

export async function createLatestVfxRetirement(
  runtime,
  profile,
  image,
  bytes,
  expectedSha256,
) {
  if (
    !(bytes instanceof Uint8Array) ||
    !(image instanceof Uint8Array) ||
    (await sha256(bytes)) !== expectedSha256 ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned native retirement package required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-system-retirement" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
    meta.systemPackageSha256 !== profile.vfxSystemSha256 ||
    runtime?.metadata?.build !== meta.build ||
    runtime.metadata.decoderImageSha256 !== meta.decoderImageSha256 ||
    runtime.metadata.frameRva !== 0x1757f10 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    meta.retireRva !== 0x1761b00 ||
    meta.collectorRva !== 0x174c2d0 ||
    meta.parentTickRva !== 0x1763220 ||
    meta.rootConstructorRva !== 0x1779b60 ||
    meta.basisRva !== 0x1762430 ||
    meta.linkTimerBlock.join(",") !== [0x16e1742, 0x16e17e6].join(",") ||
    JSON.stringify(meta.mutexImports) !== JSON.stringify(mutexImports) ||
    meta.scope.complexEmitters !== 1 ||
    meta.scope.simpleEmitters !== 0 ||
    meta.scope.meshSiblings !== 0 ||
    !meta.scope.defaultParentDefinition ||
    !meta.scope.audioIdsAbsent ||
    !meta.scope.deferredDisposalOnly ||
    meta.scope.destructorExecuted ||
    meta.scope.replayEventMapping ||
    meta.scope.mainViewerIntegrated
  )
    throw Error("Unsupported native retirement contract");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original retirement instructions changed");
  return new Retirement(runtime, meta);
}

class Retirement {
  #checkpoints = new WeakMap();
  constructor(runtime, metadata) {
    this.runtime = runtime;
    this.metadata = metadata;
    const k = runtime.kernel;
    if (attached.has(k))
      throw Error("Retirement component already attached to this kernel");
    this.mutexes = new Map();
    this.osCalls = [];
    this.substeps = [];
    this.originalExternalMath = k.externalMath;
    for (const [name, at] of Object.entries(mutexImports)) {
      if (k.mathEntries.has(at))
        throw Error("Retirement import already admitted");
      k.mathEntries.set(at, name);
    }
    // Extend the executor's declared import boundary. Unknown imports still fail
    // in the original range hook; native instructions and its budget are intact.
    k.externalMath = (name) => {
      if (!(name in mutexImports))
        return this.originalExternalMath.call(k, name);
      const at = Number(k.engine.reg_read_i64(k.uc.X86_REG_RDI));
      if (![k.a.manager + 0x190, k.a.manager + 0x1e0].includes(at))
        throw Error("Unowned retirement mutex");
      if (name === "_pthread_mutex_init") {
        if (
          this.mutexes.has(at) ||
          Number(k.engine.reg_read_i64(k.uc.X86_REG_RSI))
        )
          throw Error("Duplicate or attributed retirement mutex");
        this.mutexes.set(at, false);
      } else {
        if (
          !this.mutexes.has(at) ||
          this.mutexes.get(at) !== (name === "_pthread_mutex_unlock")
        )
          throw Error("Invalid retirement mutex ownership");
        this.mutexes.set(at, !this.mutexes.get(at));
      }
      this.osCalls.push({ name, address: at, result: 0 });
      k.engine.reg_write_i64(k.uc.X86_REG_RAX, 0n);
      k.ret();
    };
    this.substepHook = k.engine.hook_add(
      k.uc.HOOK_CODE,
      () => {
        if (Number(k.engine.reg_read_i64(k.uc.X86_REG_RDI)) !== k.a.actor)
          throw Error("Unadmitted retirement sibling");
        this.substeps.push(k.scalar(k.uc.X86_REG_XMM0));
      },
      null,
      k.base + 0x1757f10,
      k.base + 0x1757f10,
    );
    attached.add(k);
  }
  #checkReady() {
    if (
      this.closed ||
      !this.ready ||
      this.runtime.closed ||
      !this.runtime.ready
    )
      throw Error("Initialized native retirement component required");
  }
  #fragment(start, end, registers, scalars = {}) {
    const k = this.runtime.kernel;
    const hook = k.engine.hook_add(
      k.uc.HOOK_CODE,
      () => k.engine.emu_stop(),
      null,
      k.base + end,
      k.base + end,
    );
    try {
      k.callNative(start, registers, end, scalars);
    } finally {
      k.engine.hook_del(hook);
    }
  }
  initialize(createdAt = 0) {
    const k = this.runtime.kernel,
      a = k.a,
      m = this.metadata;
    if (
      this.closed ||
      !this.runtime.ready ||
      this.runtime.closed ||
      !finite(createdAt)
    )
      throw Error("Reset bound runtime and finite creation clock required");
    // A fresh runtime reset clears all manager list descriptors in owned memory.
    if ([0x188, 0x1d8, 0x228].some((offset) => k.readU32(a.manager + offset)))
      throw Error("Retirement initialization requires a fresh bound reset");
    this.mutexes = new Map();
    this.osCalls = [];
    this.substeps = [];
    k.callNative(m.rootConstructorRva, { RDI: a.systemDefinition });
    for (const block of m.initializers) {
      const regs = Object.fromEntries(
        Object.entries(block.registers).map(([name, value]) => [
          name,
          name === "RBP"
            ? a.stack - 0x100
            : typeof value === "string"
              ? a[value]
              : value,
        ]),
      );
      this.#fragment(block.startRva, block.endRva, regs);
    }
    k.engine.mem_write(a.manager + 0x284, unhex(m.nativeQualityMultipliersHex));
    k.u64(a.system + 0x30, a.manager);
    k.u64(a.system + 0x40, 0x1002f000);
    k.put(a.system + 0x48, [1, 1], "u32");
    k.u64(0x1002f000, a.actor);
    k.put(0x1002f018, [0, 1, 0]);
    k.callNative(m.basisRva, { RDI: a.system, RSI: 0x1002f018 });
    this.#fragment(
      0x174bbb3,
      0x174bbd5,
      { RBX: a.system },
      { XMM0: createdAt },
    );
    k.put(0x1002f008, [0, 0, 0]);
    this.#fragment(0x174bc15, 0x174bc8d, {
      RBX: a.system,
      RCX: 0x1002f008,
      RAX: a.resource,
    });
    this.#fragment(...m.linkTimerBlock, { RDI: a.link, R15: a.link });
    const active = k.allocate(8);
    k.u64(active, a.system);
    k.u64(a.manager + 0x180, active);
    k.put(a.manager + 0x188, [1, 1], "u32");
    for (const offset of [0x190, 0x1e0])
      k.callNative(mutexImports._pthread_mutex_init, {
        RDI: a.manager + offset,
        RSI: 0,
      });
    this.createdAt = this.lastTime = Math.fround(createdAt);
    this.ready = true;
    return this.lifecycle();
  }
  #unlocked() {
    if ([...this.mutexes.values()].some(Boolean))
      throw Error("Native retirement left a mutex locked");
  }
  request(mode) {
    this.#checkReady();
    if (typeof mode !== "boolean")
      throw Error("Explicit retirement mode required");
    const k = this.runtime.kernel;
    k.callNative(this.metadata.retireRva, {
      RDI: k.a.system,
      RSI: Number(mode),
    });
    this.#unlocked();
    return this.lifecycle();
  }
  collect() {
    this.#checkReady();
    const k = this.runtime.kernel;
    k.callNative(this.metadata.collectorRva, { RDI: k.a.manager, RSI: 0 });
    this.#unlocked();
    return this.lifecycle();
  }
  lifecycle() {
    this.#checkReady();
    const k = this.runtime.kernel,
      a = k.a,
      lists = {};
    for (const [name, offset] of [
      ["active", 0x180],
      ["retiring", 0x1d0],
      ["deferred", 0x220],
    ]) {
      const pointer = k.q(a.manager + offset),
        count = k.readU32(a.manager + offset + 8),
        capacity = k.readU32(a.manager + offset + 12);
      if (
        count > capacity ||
        capacity > 32 ||
        (count && !k.allocations.has(pointer))
      )
        throw Error("Retirement queue ownership bound");
      lists[name] = {
        pointer,
        count,
        capacity,
        values: Array.from({ length: count }, (_, i) => k.q(pointer + i * 8)),
      };
    }
    return {
      flags: new DataView(k.read(a.system + 0x2a9, 2).buffer).getUint16(
        0,
        true,
      ),
      actorFlags: k.read(a.actor + 0x18, 1)[0],
      lists,
      linkTimersHex: hex(k.read(a.link + 0x90, 8)),
      systemHex: hex(k.read(a.system, 0x2b8)),
      managerHex: hex(k.read(a.manager, 0x400)),
    };
  }
  tick(input) {
    this.#checkReady();
    const k = this.runtime.kernel,
      a = k.a;
    if (
      !finite(input.time) ||
      input.time < this.lastTime ||
      input.time > this.createdAt + 30 ||
      !Number.isInteger(input.maxSubsteps) ||
      input.maxSubsteps < 1 ||
      input.maxSubsteps > 20 ||
      !vector(input.current) ||
      !vector(input.viewPosition) ||
      ![input.cameraRight, input.cameraUp, input.viewAxis].every(vector) ||
      typeof input.multTexturePresent !== "boolean" ||
      this.lifecycle().lists.deferred.count
    )
      throw Error("Invalid native retirement tick or already deferred system");
    this.lastTime = input.time;
    this.substeps = [];
    k.births = [];
    k.mathCalls = [];
    k.services = {};
    k.put(a.system + 0x108, input.current);
    k.u64(a.link + 0x58, input.multTexturePresent ? 0x20000000 : 0);
    k.engine.mem_write(a.stack - 0x8000, new Uint8Array(0x8000));
    k.callNative(
      this.metadata.parentTickRva,
      { RDI: a.system, RSI: input.maxSubsteps },
      null,
      { XMM0: input.time },
    );
    const state = k.snapshot(),
      geometry = this.runtime.renderGeometry(input.viewPosition, {
        right: input.cameraRight,
        up: input.cameraUp,
        axis: input.viewAxis,
        multTexturePresent: input.multTexturePresent,
      });
    return {
      state,
      geometry,
      substeps: [...this.substeps],
      lifecycle: this.lifecycle(),
    };
  }
  checkpoint() {
    this.#checkReady();
    this.#unlocked();
    const parent = this.runtime.checkpoint(),
      handle = Object.freeze({ time: this.lastTime, bytes: parent.bytes });
    this.#checkpoints.set(handle, {
      parent,
      createdAt: this.createdAt,
      lastTime: this.lastTime,
      mutexes: new Map(this.mutexes),
    });
    return handle;
  }
  restore(handle) {
    const saved = this.#checkpoints.get(handle);
    if (this.closed || !saved)
      throw Error("Unknown, released or foreign retirement checkpoint");
    this.runtime.restore(saved.parent);
    this.createdAt = saved.createdAt;
    this.lastTime = saved.lastTime;
    this.mutexes = new Map(saved.mutexes);
    this.osCalls = [];
    this.substeps = [];
    this.ready = true;
  }
  releaseCheckpoint(handle) {
    const saved = this.#checkpoints.get(handle);
    if (this.closed || !saved)
      throw Error("Unknown, released or foreign retirement checkpoint");
    this.runtime.releaseCheckpoint(saved.parent);
    this.#checkpoints.delete(handle);
  }
  close() {
    if (this.closed) return;
    this.#unlocked();
    const k = this.runtime.kernel;
    k.engine.hook_del(this.substepHook);
    k.externalMath = this.originalExternalMath;
    for (const at of Object.values(mutexImports)) k.mathEntries.delete(at);
    attached.delete(k);
    this.closed = true;
  }
}
