// Resource-context components for the original VFX object factory. The graphics
// provider remains absent; no successful texture/material callback is fabricated.
import { sha256 } from "./structural-comparison.mjs";
export const VFX_RESOURCE_CONTEXT_SHA =
  "e39b8f0739fa6515b8a0b408a465c253cde7c72bc0da08869db727ddd5918ba5";
const managerBlocks = [
  [0x1745440, 0x17454fb],
  [0x1745581, 0x1745591],
  [0x1745693, 0x17456a3],
  [0x17456d4, 0x17456f7],
];
const texturePrefix = [0x17e2301, 0x17e240c];
const imports = {
  _mach_timebase_info: 0x1feea2c,
  _strlen: 0x1feedec,
  _strcmp: 0x1feedb6,
  ___bzero: 0x1fee5fa,
  ____chkstk_darwin: 0x1fee5f4,
};
const unhex = (value) =>
  Uint8Array.from(value.match(/../g)?.map((v) => parseInt(v, 16)) ?? []);
const hex = (bytes) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");

export async function createVfxResourceContextExtension(k, bytes, fragment) {
  if (
    !(bytes instanceof Uint8Array) ||
    (await sha256(bytes)) !== VFX_RESOURCE_CONTEXT_SHA
  )
    throw Error("Pinned VFX resource context required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.kind !== "native-vfx-resource-context" ||
    meta.build !== k.profile.clientVersion ||
    meta.protocol !== k.profile.protocolDigest ||
    meta.decoderImageSha256 !== k.profile.decoderImageSha256 ||
    meta.objectPackageSha256 !==
      "2b93f3a294357fed50235f5ea22126feea9437694f974b6b1fe6751fe28a239a" ||
    JSON.stringify(meta.managerInputBlocks) !== JSON.stringify(managerBlocks) ||
    JSON.stringify(meta.textureManagerPrefix) !==
      JSON.stringify(texturePrefix) ||
    !meta.scope.fullMaterialCacheConstructor ||
    !meta.scope.originalClockGetterAndFrequencyExecuted ||
    !meta.scope.nativeResourceObserverVectorMutated ||
    meta.scope.graphicsProvider ||
    meta.scope.fullTextureManagerConstructor ||
    meta.scope.mainViewerIntegrated ||
    meta.initializedGlobals.length !== 1 ||
    meta.initializedGlobals[0].rva !== 0x256c9c0 ||
    !/^[a-f0-9]{768}$/.test(meta.initializedGlobals[0].bytesHex) ||
    meta.assetBaseline.heapStart !== 0x10400000 ||
    meta.assetBaseline.heapEnd !== 0x10423e20 ||
    meta.assetBaseline.heapHex.length !==
      (meta.assetBaseline.heapEnd - meta.assetBaseline.heapStart) * 2 ||
    meta.assetBaseline.allocations.length !== 966 ||
    meta.assetBaseline.globals.length !== 27 ||
    Object.keys(imports).some(
      (name) => meta.libraryImports[name] !== imports[name],
    )
  )
    throw Error("Unsupported native VFX resource context");
  for (const b of meta.sourceBlocks)
    if (
      (await sha256(k.read(k.base + b.startRva, b.endRva - b.startRva))) !==
      b.sha256
    )
      throw Error("Original VFX resource context instructions changed");
  return new VfxResourceContext(k, meta, fragment);
}

class VfxResourceContext {
  constructor(kernel, metadata, fragment) {
    this.k = kernel;
    this.metadata = metadata;
    this.fragment = fragment;
    const k = kernel;
    // Stable endpoint hooks must outlive world resets in the pinned WASM engine.
    for (const end of new Set([
      ...managerBlocks.map((b) => b[1]),
      texturePrefix[1],
      0x15eaf0a,
    ]))
      k.engine.hook_add(
        k.uc.HOOK_CODE,
        () => {
          if (this.endpoint === end) k.engine.emu_stop();
        },
        null,
        k.base + end,
        k.base + end,
      );
    for (const [name, at] of Object.entries(imports)) {
      if (k.mathEntries.has(at) && k.mathEntries.get(at) !== name)
        throw Error("Resource context import already installed");
      k.mathEntries.set(at, name);
    }
    this.reset();
  }
  reset() {
    this.active = false;
    this.initialized = false;
    this.failed = false;
    this.endpoint = null;
    this.attrs = new Map();
    this.mutexes = new Map();
    this.calls = [];
    this.parents = new Set();
    this.timebase = null;
    this.clock = null;
    this.textureManager = null;
    this.materialCache = null;
    this.baselinePrepared = false;
    this.libraryMutexes = new Map();
  }
  prepareBaseline() {
    const k = this.k,
      b = this.metadata.assetBaseline;
    if (k.allocations.size || k.nextHeap < b.heapEnd)
      throw Error("Asset baseline requires a fresh owned world");
    k.engine.mem_write(b.heapStart, unhex(b.heapHex));
    for (const g of b.globals)
      k.engine.mem_write(k.base + g.rva, unhex(g.bytesHex));
    for (const input of b.ownedInputs)
      k.engine.mem_write(input.address, unhex(input.bytesHex));
    k.allocations = new Map(b.allocations);
    this.libraryMutexes = new Map(
      Object.entries(b.mutexes).map(([at, locked]) => [Number(at), locked]),
    );
    this.baselinePrepared = true;
  }
  executeFragment(start, end, registers = {}) {
    this.endpoint = end;
    try {
      this.fragment(start, end, registers);
    } finally {
      this.endpoint = null;
    }
  }
  initialize() {
    if (this.active) throw Error("Resource context already initialized");
    if (!this.baselinePrepared)
      throw Error(
        "Resource package must be supplied to loadSystem before shared baseline startup",
      );
    this.active = true;
    const k = this.k,
      a = k.a;
    for (const g of this.metadata.initializedGlobals)
      k.engine.mem_write(k.base + g.rva, unhex(g.bytesHex));
    for (const [start, end] of managerBlocks)
      this.executeFragment(start, end, {
        RDI: a.manager,
        RSI: 0,
        RBX: a.manager,
        RBP: a.stack - 8,
        RSP: a.stack - 0xe8,
      });
    k.callNative(0x1474a30, { RDI: 0x108 });
    this.textureManager = Number(k.engine.reg_read_i64(k.uc.X86_REG_RAX));
    this.executeFragment(...texturePrefix, {
      RDI: this.textureManager,
      RBP: a.stack - 8,
      RSP: a.stack - 0xa0,
    });
    k.callNative(0x1474a30, { RDI: 0x90 });
    this.materialCache = Number(k.engine.reg_read_i64(k.uc.X86_REG_RAX));
    k.callNative(0x17c3fd0, { RDI: this.materialCache });
    if (
      k.q(k.base + 0x246fdf0) !== this.textureManager ||
      k.q(k.base + 0x247c9c0) !== this.materialCache
    )
      throw Error("Original resource singleton publication differs");
    this.initialized = true;
    return this.state();
  }
  import(name) {
    if (!this.active) return false;
    const k = this.k,
      e = k.engine,
      u = k.uc,
      a = k.a,
      first = Number(e.reg_read_i64(u.X86_REG_RDI)),
      second = Number(e.reg_read_i64(u.X86_REG_RSI));
    let call = { name },
      result = 0n;
    if (name === "_mach_timebase_info") {
      if (!this.timebase || first < a.stack - 0x100 || first > a.stack - 8)
        throw Error("Unowned clock timebase request");
      k.put(first, this.timebase, "u32");
      Object.assign(call, { numer: this.timebase[0], denom: this.timebase[1] });
    } else if (name === "_strlen" || name === "_strcmp") {
      const string = (at) => {
        const out = [];
        for (let i = 0; i < 4096; i++) {
          if (!this.libraryPointer(at + i, 1))
            throw Error("Native resource string outside owned bounds");
          const value = k.read(at + i, 1)[0];
          if (!value) return out;
          out.push(value);
        }
        throw Error("Unterminated native resource string");
      };
      const left = string(first);
      if (name === "_strlen") result = BigInt(left.length);
      else {
        const right = string(second);
        left.push(0);
        right.push(0);
        for (let i = 0; i < Math.min(left.length, right.length); i++)
          if (left[i] !== right[i]) {
            result = BigInt(left[i] - right[i]);
            break;
          }
      }
    } else if (name === "___bzero") {
      if (
        second < 0 ||
        second > 0x100000 ||
        first < 0x10000000 ||
        first > 0x12000000 - second
      )
        throw Error("Unowned native resource zero fill");
      if (second) k.engine.mem_write(first, new Uint8Array(second));
    } else if (name === "____chkstk_darwin") {
      const count = Number(e.reg_read_i64(u.X86_REG_RAX)),
        sp = Number(e.reg_read_i64(u.X86_REG_RSP));
      if (
        k.q(sp) - k.base !== 0x1499b00 ||
        count !== 0x1028 ||
        sp - count < 0x10008000 ||
        sp > 0x10010008
      )
        throw Error("Unadmitted native resource stack probe");
      for (let at = sp - count; at <= sp; at += 4096) k.read(at, 1);
      result = BigInt(count);
    } else if (name.startsWith("_pthread_mutexattr_")) {
      if (first < a.stack - 0x8000 || first > a.stack - 8)
        throw Error("Unowned resource mutex attributes");
      if (name === "_pthread_mutexattr_init") {
        if (this.attrs.has(first))
          throw Error("Duplicate resource mutex attributes");
        this.attrs.set(first, 0);
      } else if (!this.attrs.has(first))
        throw Error("Uninitialized resource mutex attributes");
      else if (name === "_pthread_mutexattr_settype") {
        if (second !== 2) throw Error("Unadmitted resource mutex type");
        this.attrs.set(first, 2);
      } else if (name === "_pthread_mutexattr_destroy")
        this.attrs.delete(first);
      else throw Error("Unsupported resource mutex attribute operation");
      Object.assign(call, { attributes: first, argument: second });
    } else if (
      [
        "_pthread_mutex_init",
        "_pthread_mutex_lock",
        "_pthread_mutex_unlock",
      ].includes(name)
    ) {
      const owner = [...k.allocations].find(
        ([at, n]) =>
          (n === 0x108 && first === at + 0x10) ||
          (n === 0x2c0 && first === at + 0x98),
      )?.[0];
      if (owner === undefined) {
        if (this.libraryMutexes.has(first)) {
          const locked = this.libraryMutexes.get(first);
          if (
            name === "_pthread_mutex_init" ||
            locked !== (name === "_pthread_mutex_unlock")
          )
            throw Error("Invalid resource library mutex ownership");
          this.libraryMutexes.set(first, !locked);
          this.calls.push({ name, mutex: first });
          e.reg_write_i64(u.X86_REG_RAX, 0n);
          k.ret();
          return true;
        }
        return false;
      }
      if (name === "_pthread_mutex_init") {
        if (this.mutexes.has(first) || (second && !this.attrs.has(second)))
          throw Error("Invalid resource mutex initialization");
        this.mutexes.set(first, {
          recursive: !!second && this.attrs.get(second) === 2,
          depth: 0,
        });
      } else {
        const mutex = this.mutexes.get(first);
        if (!mutex) throw Error("Uninitialized resource mutex");
        if (name === "_pthread_mutex_lock") {
          if (mutex.depth && !mutex.recursive)
            throw Error("Nonrecursive resource mutex reentry");
          mutex.depth++;
        } else {
          if (!mutex.depth) throw Error("Unlock of unowned resource mutex");
          mutex.depth--;
        }
      }
      Object.assign(call, { owner, mutex: first, ...this.mutexes.get(first) });
    } else return false;
    this.calls.push(call);
    e.reg_write_i64(u.X86_REG_RAX, BigInt.asUintN(64, result));
    k.ret();
    return true;
  }
  requireReady() {
    if (!this.initialized || this.failed)
      throw Error("Initialized, unfailed native resource context required");
  }
  libraryPointer(at, size) {
    return (
      (at >= 0x10000000 && at <= 0x12000000 - size) ||
      (at >= this.k.base &&
        at <= this.k.base + this.k.profile.sizeOfImage - size)
    );
  }
  setClockInputs({ ticks, mode, timebase }) {
    this.requireReady();
    if (
      !Array.isArray(ticks) ||
      ticks.length !== 3 ||
      ticks.some((t) => typeof t !== "bigint" || t < 0n || t >= 2n ** 63n) ||
      ![0, 1, 2].includes(mode) ||
      !Array.isArray(timebase) ||
      timebase.length !== 2 ||
      timebase.some((t) => !Number.isInteger(t) || t <= 0 || t > 0xffffffff)
    )
      throw Error(
        "Three explicit clock ticks, selector mode and positive Darwin timebase required",
      );
    if (this.timebase && this.timebase.some((v, i) => v !== timebase[i]))
      throw Error("Clock timebase cannot change within one owned world");
    this.timebase = [...timebase];
    const k = this.k;
    k.callNative(0x14db4b0, {});
    const frequency = k.engine.reg_read_i64(k.uc.X86_REG_RAX);
    if (frequency <= 0n || frequency >= 2n ** 63n)
      throw Error("Unadmitted native clock frequency");
    this.executeFragment(0x15eaeac, 0x15eaf0a, { RAX: frequency });
    const context = k.allocate(0x50),
      selector = k.allocate(0x10);
    k.u64(context + 0x48, selector);
    k.put(selector + 8, [mode], "u8");
    for (const [index, offset] of [0x10, 0x18, 0x20].entries()) {
      const wrapper = k.allocate(0x10),
        source = k.allocate(0x38),
        data = k.allocate(8);
      k.u64(wrapper, source);
      k.put(wrapper + 8, [0], "u8");
      k.u64(source + 0x30, data);
      k.u64(data, ticks[index]);
      k.u64(context + offset, wrapper);
    }
    k.u64(k.base + 0x246d000, context);
    this.clock = {
      context,
      ticks: [...ticks],
      selectorMode: mode,
      timebase: [...timebase],
      nativeFrequency: frequency,
      tickScale: new DataView(k.read(k.base + 0x256d398, 8).buffer).getFloat64(
        0,
        true,
      ),
    };
    return structuredClone(this.clock);
  }
  activate(address) {
    this.requireReady();
    if (!this.clock)
      throw Error("Explicit native clock inputs required before activation");
    if (this.parents.has(address))
      throw Error(
        "Repeated native activation is outside this one-shot contract",
      );
    const k = this.k;
    try {
      k.callNative(0x1765960, { RDI: address });
    } catch (error) {
      this.failed = true;
      const rva = Number(k.engine.reg_read_i64(k.uc.X86_REG_RIP)) - k.base;
      throw Error(
        `Native activation reached unsupported input at RVA 0x${rva.toString(16)}: ${error.message}`,
      );
    }
    this.parents.add(address);
    const parent = k.q(address + 0x28);
    if (parent && k.allocations.get(parent) !== 0x2c0)
      throw Error("Original parent allocation differs");
    return {
      parent,
      parentBytes: parent ? k.read(parent, 0x2c0) : null,
      activeParentCount: k.readU32(k.a.manager + 0x188),
    };
  }
  state() {
    this.requireReady();
    if (
      this.attrs.size ||
      [...this.mutexes.values()].some((m) => m.depth) ||
      [...this.libraryMutexes.values()].some(Boolean)
    )
      throw Error("Resource context retained mutex ownership");
    const k = this.k;
    return {
      textureManager: this.textureManager,
      materialCache: this.materialCache,
      textureManagerHex: hex(k.read(this.textureManager, 0x108)),
      materialCacheHex: hex(k.read(this.materialCache, 0x90)),
      mutexes: Object.fromEntries(this.mutexes),
      scope: {
        fullMaterialCacheConstructor: true,
        textureManagerPrefix: true,
        fullTextureManagerConstructor: false,
        graphicsProvider: false,
        defaultTexturesCreated: false,
        gameCallbacksReplaced: false,
      },
    };
  }
}
