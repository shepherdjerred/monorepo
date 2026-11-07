// Original object factory over complete authored roots. Parent activation,
// world registration, worker scheduling and rendering are separate boundaries.
import { sha256 } from "./structural-comparison.mjs";
import { NativeVfxSpawnKernel, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { createLatestVfxSystemAssetInventory } from "./latest-vfx-system-assets.mjs";
import {
  createVfxResourceContextExtension,
  VFX_RESOURCE_CONTEXT_SHA,
} from "./latest-vfx-resource-context.mjs";

export const VFX_OBJECTS_PACKAGE_SHA =
  "2b93f3a294357fed50235f5ea22126feea9437694f974b6b1fe6751fe28a239a";
const hex = (bytes) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
const blocks = [
  [0x1745424, 0x1745440],
  [0x17454fb, 0x174552f],
  [0x174552f, 0x174554e],
  [0x174554e, 0x1745581],
  [0x174565c, 0x1745687],
  [0x17456b4, 0x17456cc],
];
const imports = {
  _memset_pattern16: 0x1feea56,
  _pthread_mutexattr_destroy: 0x1feec0c,
  _pthread_mutexattr_init: 0x1feec12,
  _pthread_mutexattr_settype: 0x1feec18,
  _pthread_mutex_init: 0x1feebf4,
  _pthread_mutex_lock: 0x1feebfa,
  _pthread_mutex_unlock: 0x1feec06,
};

export async function createLatestVfxObjects({
  uc,
  profile,
  image,
  packageBytes,
  systemsPackageBytes,
  effectsBytes,
  nativeAssetBytes,
  spawnBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(packageBytes)) !== VFX_OBJECTS_PACKAGE_SHA ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256
  )
    throw Error("Pinned original VFX object inputs required");
  const meta = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
    ),
    spawn = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(spawnBytes),
    );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-vfx-object-creation" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.systemsPackageSha256 !== (await sha256(systemsPackageBytes)) ||
    meta.spawnPackageSha256 !== profile.vfxSpawnSha256 ||
    spawn.build !== meta.build ||
    spawn.protocol !== meta.protocol ||
    spawn.decoderImageSha256 !== meta.decoderImageSha256 ||
    spawn.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    meta.managerAddress !== 0x1002c000 ||
    meta.managerBytes !== 0x3a8 ||
    meta.rootAddress !== 0x10020000 ||
    meta.objectBytes !== 0x238 ||
    meta.factoryRva !== 0x174b760 ||
    meta.constructorRva !== 0x17652c0 ||
    meta.firstScalarRva !== 0x1767120 ||
    meta.secondScalarRva !== 0x1755ea0 ||
    meta.readyRva !== 0x1765950 ||
    JSON.stringify(meta.managerBlocks) !== JSON.stringify(blocks) ||
    JSON.stringify(meta.imports) !== JSON.stringify(imports) ||
    meta.tagStartupBlock.join(",") !== [0x665f24, 0x665f51].join(",") ||
    meta.mutexOffsets.join(",") !== [0x190, 0x1e0, 0x240].join(",") ||
    !meta.scope.independentManagerInitializersExecuted ||
    !meta.scope.originalObjectFactoryExecuted ||
    meta.scope.completeManagerConstructorExecuted ||
    meta.scope.workerPoolExecuted ||
    meta.scope.parentActivationExecuted ||
    meta.scope.resourceAcquisitionExecuted ||
    meta.scope.worldRegistryExecuted ||
    meta.scope.mainViewerIntegrated
  )
    throw Error("Unsupported original VFX object contract");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original VFX object instructions changed");
  const inventory = await createLatestVfxSystemAssetInventory(
    profile,
    systemsPackageBytes,
    effectsBytes,
    nativeAssetBytes,
  );
  return new VfxObjects(
    new NativeVfxSpawnKernel(uc, profile, image, spawn, null, spawnPreviewMath),
    meta,
    inventory,
    image.length,
  );
}

class VfxObjects {
  #kernel;
  #inventory;
  #pages = new Map();
  #attrs = new Map();
  #mutexes = new Map();
  #calls = [];
  #handles = new Set();
  #tracking = false;
  #loaded = false;
  #graph;
  #meta;
  #endpoint = null;
  #resourceContext = null;
  constructor(kernel, metadata, inventory, imageLength) {
    this.#kernel = kernel;
    this.#inventory = inventory;
    this.#meta = structuredClone(metadata);
    this.#graph = null;
    const k = kernel;
    // Install endpoints once. Removing/readding a code hook can leave already
    // translated successor blocks without the new callback in this WASM build.
    for (const end of new Set([
      ...blocks.map((b) => b[1]),
      metadata.tagStartupBlock[1],
    ]))
      k.engine.hook_add(
        k.uc.HOOK_CODE,
        () => {
          if (this.#endpoint === end) k.engine.emu_stop();
        },
        null,
        k.base + end,
        k.base + end,
      );
    for (const [name, at] of Object.entries(imports)) {
      if (k.mathEntries.has(at))
        throw Error("VFX object import already admitted");
      k.mathEntries.set(at, name);
    }
    k.externalMath = (name) => this.#import(name);
    // Restore original writable image state between independent owned worlds.
    const captureImageWrite = (address, size) => {
      if (!this.#tracking) return;
      const first = Math.floor(Number(address) / 4096) * 4096,
        end = Math.ceil((Number(address) + size) / 4096) * 4096;
      for (let page = first; page < end; page += 4096)
        if (!this.#pages.has(page))
          this.#pages.set(
            page,
            k.read(page, Math.min(4096, k.base + imageLength - page)),
          );
    };
    k.engine.hook_add(
      k.uc.HOOK_MEM_WRITE,
      (_e, _kind, address, size) => captureImageWrite(address, size),
      null,
      k.base,
      k.base + imageLength - 1,
    );
    // Host-modeled guard-release writes bypass Unicorn memory-write hooks.
    const originalService = k.service;
    k.service = (at) => {
      if (at === 0x1fee62a) {
        const dest = Number(k.engine.reg_read_i64(k.uc.X86_REG_RDI));
        if (dest >= k.base && dest < k.base + imageLength)
          captureImageWrite(dest, 1);
      }
      return originalService.call(k, at);
    };
  }
  #open() {
    if (this.closed) throw Error("Closed VFX object executor");
  }
  #ready() {
    this.#open();
    if (!this.#loaded)
      throw Error("Complete VFX root and initialized manager required");
  }
  #fragment(start, end, registers = {}, scalars = {}) {
    const k = this.#kernel;
    if (this.#endpoint !== null) throw Error("Reentrant VFX fragment");
    this.#endpoint = end;
    try {
      k.callNative(start, registers, end, scalars);
    } catch (error) {
      throw Error(
        `${error}; object fragment=${start.toString(16)}, RIP=${k.engine.reg_read_i64(k.uc.X86_REG_RIP).toString(16)}`,
      );
    } finally {
      this.#endpoint = null;
    }
  }
  #import(name) {
    if (this.#resourceContext?.import(name)) return;
    const k = this.#kernel,
      e = k.engine,
      u = k.uc,
      a = k.a,
      first = Number(e.reg_read_i64(u.X86_REG_RDI)),
      second = Number(e.reg_read_i64(u.X86_REG_RSI)),
      call = { name };
    if (name === "_memset_pattern16") {
      const count = Number(e.reg_read_i64(u.X86_REG_RDX));
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > 0x100000 ||
        first < 0x10000000 ||
        first > 0x12000000 - count ||
        !(
          (second >= 0x10000000 && second <= 0x12000000 - 16) ||
          (second >= k.base && second <= k.base + k.profile.sizeOfImage - 16)
        )
      )
        throw Error("VFX pattern fill outside owned source/destination");
      const pattern = k.read(second, 16),
        value = new Uint8Array(count);
      for (let index = 0; index < count; index++)
        value[index] = pattern[index % 16];
      if (count) e.mem_write(first, value);
      Object.assign(call, {
        destination: first,
        source: second,
        count,
        patternHex: hex(pattern),
      });
    } else if (name.startsWith("_pthread_mutexattr_")) {
      if (first < a.stack - 0x8000 || first > a.stack - 8)
        throw Error("Unowned VFX mutex attribute storage");
      if (name === "_pthread_mutexattr_init") {
        if (this.#attrs.has(first))
          throw Error("Duplicate live VFX mutex attributes");
        this.#attrs.set(first, 0);
      } else if (!this.#attrs.has(first))
        throw Error("Uninitialized VFX mutex attributes");
      else if (name === "_pthread_mutexattr_settype") {
        if (second !== 2) throw Error("Unadmitted Darwin VFX mutex type");
        this.#attrs.set(first, 2);
      } else if (name === "_pthread_mutexattr_destroy")
        this.#attrs.delete(first);
      else throw Error("Unadmitted VFX mutex attribute function");
      Object.assign(call, { attributes: first, argument: second });
    } else if (
      [
        "_pthread_mutex_init",
        "_pthread_mutex_lock",
        "_pthread_mutex_unlock",
      ].includes(name)
    ) {
      if (
        ![0x190, 0x1e0, 0x240].includes(first - a.manager) &&
        !(this.#resourceContext?.active && first - a.manager === 0x18)
      )
        throw Error("Unowned VFX manager mutex");
      if (name === "_pthread_mutex_init") {
        if (this.#mutexes.has(first) || (second && !this.#attrs.has(second)))
          throw Error("Invalid VFX manager mutex initialization");
        this.#mutexes.set(first, {
          recursive: !!second && this.#attrs.get(second) === 2,
          depth: 0,
        });
      } else {
        const mutex = this.#mutexes.get(first);
        if (!mutex) throw Error("Uninitialized VFX manager mutex");
        if (name === "_pthread_mutex_lock") {
          if (mutex.depth && !mutex.recursive)
            throw Error("Nonrecursive VFX mutex reentry");
          mutex.depth++;
        } else {
          if (!mutex.depth) throw Error("Unlock of unowned VFX manager mutex");
          mutex.depth--;
        }
      }
      Object.assign(call, {
        mutex: first,
        depth: this.#mutexes.get(first).depth,
      });
    } else throw Error(`Unadmitted VFX object external function: ${name}`);
    this.#calls.push(call);
    e.reg_write_i64(u.X86_REG_RAX, 0n);
    k.ret();
  }
  async loadSystem(
    effectId,
    effectBytes,
    graphBytes,
    { quality, graphics34b, sceneInput, resourcePackageBytes } = {},
  ) {
    this.#open();
    if (
      ![0, 1, 2, 3].includes(quality) ||
      typeof graphics34b !== "boolean" ||
      sceneInput !== 0
    )
      throw Error(
        "Explicit quality, graphics field and null owned scene input required",
      );
    const graph = await this.#inventory.bindSystem(
        effectId,
        effectBytes,
        graphBytes,
      ),
      k = this.#kernel,
      a = k.a;
    this.#loaded = false;
    this.#tracking = false;
    for (const [page, bytes] of this.#pages) k.engine.mem_write(page, bytes);
    this.#pages.clear();
    this.#attrs.clear();
    this.#mutexes.clear();
    this.#calls = [];
    this.#handles.clear();
    this.#resourceContext?.reset();
    k.nextHeap = graph.heapStart + graph.heap.length;
    k.allocations = new Map();
    k.services = {};
    k.mathCalls = [];
    k.births = [];
    k.engine.mem_write(a.definition, graph.object);
    k.engine.mem_write(graph.heapStart, graph.heap);
    k.engine.mem_write(a.manager, new Uint8Array(0x3a8).fill(0xa5));
    if (resourcePackageBytes !== undefined) {
      await this.#ensureResourceContext(resourcePackageBytes);
      this.#resourceContext.prepareBaseline();
    }
    this.#tracking = true;
    this.#fragment(...this.#meta.tagStartupBlock);
    for (const [start, end] of blocks)
      this.#fragment(
        start,
        end,
        {
          RDI: a.manager,
          RSI: sceneInput,
          RBX: a.manager,
          RBP: a.stack - 8,
          RSP: a.stack - 0xe8,
        },
        { XMM0: 0 },
      );
    k.put(a.manager + 0x29c, [quality], "u8");
    k.put(a.manager + 0x34b, [+graphics34b], "u8");
    if (
      hex(k.read(a.manager + 0x284, 24)) !==
        this.#meta.qualityMultiplierBytesHex ||
      this.#attrs.size ||
      [...this.#mutexes.values()].some((m) => m.depth)
    )
      throw Error("Original VFX initialization or synchronization differs");
    this.#graph = graph;
    this.#loaded = true;
  }
  create() {
    this.#ready();
    const k = this.#kernel;
    k.callNative(this.#meta.factoryRva, {
      RDI: k.a.manager,
      RSI: k.a.definition,
      RDX: 0,
    });
    const address = Number(k.engine.reg_read_i64(k.uc.X86_REG_RAX));
    if (k.allocations.get(address) !== 0x238)
      throw Error("Original VFX object allocation changed");
    const handle = Object.freeze({ address });
    this.#handles.add(handle);
    return handle;
  }
  async initializeResourceContext(packageBytes) {
    this.#ready();
    if (this.#handles.size)
      throw Error("Resource context must precede object creation");
    await this.#ensureResourceContext(packageBytes);
    return this.#resourceContext.initialize();
  }
  async #ensureResourceContext(packageBytes) {
    if (!this.#resourceContext)
      this.#resourceContext = await createVfxResourceContextExtension(
        this.#kernel,
        packageBytes,
        (start, end, registers) => this.#fragment(start, end, registers),
      );
    else if ((await sha256(packageBytes)) !== VFX_RESOURCE_CONTEXT_SHA)
      throw Error("Changed resource context package on an existing executor");
  }
  setClockInputs(input) {
    this.#ready();
    if (!this.#resourceContext) throw Error("Native resource context required");
    return this.#resourceContext.setClockInputs(input);
  }
  activate(handle) {
    const address = this.#owned(handle);
    if (!this.#resourceContext) throw Error("Native resource context required");
    return this.#resourceContext.activate(address);
  }
  resourceContextState() {
    this.#ready();
    if (!this.#resourceContext) throw Error("Native resource context required");
    return this.#resourceContext.state();
  }
  #owned(handle) {
    this.#ready();
    if (!this.#handles.has(handle))
      throw Error("Unowned or stale VFX object handle");
    return handle.address;
  }
  bytes(handle) {
    return this.#kernel.read(this.#owned(handle), 0x238);
  }
  setScalars(handle, firstBits, secondBits) {
    const address = this.#owned(handle),
      k = this.#kernel;
    const scalars = [
      [this.#meta.firstScalarRva, firstBits],
      [this.#meta.secondScalarRva, secondBits],
    ].map(([entry, bits]) => {
      if (!Number.isSafeInteger(bits) || bits < 0 || bits > 0xffffffff)
        throw Error("Original scalar requires raw u32 float bits");
      const value = new DataView(new ArrayBuffer(4));
      value.setUint32(0, bits, true);
      if (!Number.isFinite(value.getFloat32(0, true)))
        throw Error("Nonfinite VFX scalar");
      return [entry, value.getFloat32(0, true)];
    });
    for (const [entry, scalar] of scalars)
      k.callNative(entry, { RDI: address }, null, { XMM0: scalar });
  }
  markReady(handle) {
    this.#kernel.callNative(this.#meta.readyRva, { RDI: this.#owned(handle) });
  }
  get metadata() {
    return structuredClone(this.#meta);
  }
  state() {
    this.#ready();
    const k = this.#kernel,
      pointer = k.q(k.a.manager + 0x230),
      count = k.readU32(k.a.manager + 0x238),
      capacity = k.readU32(k.a.manager + 0x23c);
    if (
      count !== this.#handles.size ||
      capacity < count ||
      (count && (k.allocations.get(pointer) ?? 0) < count * 8)
    )
      throw Error("Original VFX pending queue escaped owned objects");
    const queue = Array.from({ length: count }, (_, i) => k.q(pointer + i * 8)),
      objects = [...this.#handles].map((h) => ({
        address: h.address,
        bytesHex: hex(this.bytes(h)),
      }));
    if (
      queue.some((p, i) => p !== objects[i].address) ||
      this.#attrs.size ||
      [...this.#mutexes.values()].some((m) => m.depth)
    )
      throw Error("VFX queue order or mutex ownership differs");
    return {
      managerHex: hex(k.read(k.a.manager, 0x3a8)),
      queue,
      capacity,
      objects,
      osCalls: structuredClone(this.#calls),
      mutexes: Object.fromEntries(
        [...this.#mutexes].map(([a, m]) => [a, { ...m }]),
      ),
    };
  }
  authoredBytes() {
    this.#ready();
    return {
      object: this.#kernel.read(this.#kernel.a.definition, 0x160),
      heap: this.#kernel.read(this.#graph.heapStart, this.#graph.heap.length),
    };
  }
  close() {
    if (this.closed) return;
    this.#tracking = false;
    this.#kernel.close();
    this.closed = true;
    this.#handles.clear();
    this.#pages.clear();
    this.#graph = null;
  }
}
