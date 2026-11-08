// Whole-parent CPU execution over exact-build, offline-warmed resource metadata.
// Foreign graphics/file callbacks fail; native GLES handles are never browser handles.
import { NativeDecoder } from "./native-decoder.mjs";
import { NativeVfxSpawnKernel } from "./latest-vfx-spawn.mjs";
import { loadParentMath, installParentMath } from "./latest-parent-math.mjs";
import {
  applyParentPlacement,
  synchronizeParentPlacement,
} from "./latest-parent-placement.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  loadLatestWorldEffectABI,
  boundedWorldNextPrime,
} from "./latest-world-effect-abi.mjs";
import {
  loadLatestWorldDescriptorABI,
  routeWorldSharedOwnership,
} from "./latest-world-descriptor-abi.mjs";
import {
  PARENT_DRAW_CACHES_SHA,
  loadParentDrawParameterABI,
  validateParentDrawCache,
  routeParentDrawMemcmp,
  evaluateParentDrawParameters,
} from "./latest-parent-draw-parameters.mjs";
export { PARENT_DRAW_CACHES_SHA };

export const PARENT_RUNTIME_SHA =
  "4299d21da35758c4d6fff60415f22246c5c811bced9112e063ddf9790c8e5eb0";
export const PARENT_CACHES_SHA =
  "322825875546e0b53662de4500e3e0f6b9e56cbb5bf75ed02085e8da6cdc2462";
export const PARENT_REQUESTED_CACHES_SHA =
  "48b21eb89f872b724ca71d8eb5e0c6eb3dabd50542b09ec9977c9337c09e28ba";
export const PARENT_RAY_CACHES_SHA =
  "824dc70e8c730b916a193fb4ccfbd0c32b2626e30a6ce1e0b4d71e85d462d3ad";
const decode = (b) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
const hex = (b) =>
  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
const finite = (v) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  Number.isFinite(Math.fround(v));
const fnv = (s) => {
  let v = 0x811c9dc5;
  for (const c of s.toLowerCase())
    v = Math.imul(v ^ c.charCodeAt(0), 0x1000193) >>> 0;
  return v;
};
const G = {
  context: 0x10030000,
  view: 0x10031000,
  draw: 0x10032000,
  indices: 0x10040000,
  vertices: 0x10080000,
};
const CAMERA_CACHE = 0x100e0000,
  CAMERA_INPUT = 0x100e3000;
const WRITERS = new Map([
  [0x23f23b0, ["camera-quad", 0x1733290]],
  [0x23f20c8, ["arbitrary-quad", 0x1730410]],
  [0x23f6520, ["camera-trail", 0x1737570]],
  [0x23f26e0, ["ray", 0x1734a30]],
  [0x23f6678, ["arbitrary-trail", 0x1737570]],
]);
const VECTORS = {
  life: [8, 8],
  initial: [0x18, 0x70],
  matrices: [0x28, 0x40],
  particle: [0x38, 0xac],
  motion: [0x48, 0x24],
  uv: [0x58, 0x20],
  multUv: [0x68, 0x18],
  unknown78: [0x78, 0x18],
  unknown88: [0x88, 0x18],
  attributes: [0x98, 0x2c],
  tiling: [0xa8, 8],
  odometer: [0xb8, 4],
  ordinal: [0xc8, 4],
};

export function assertParentCamera(camera) {
  for (const name of ["position", "right", "up", "axis"])
    if (
      !Array.isArray(camera?.[name]) ||
      camera[name].length !== 3 ||
      !camera[name].every(finite)
    )
      throw Error("Explicit finite parent camera required");
  const axes = [camera.right, camera.up, camera.axis];
  if (
    axes.some((a) => Math.abs(a.reduce((s, x) => s + x * x, 0) - 1) > 2e-5) ||
    [
      [0, 1],
      [0, 2],
      [1, 2],
    ].some(
      ([a, b]) =>
        Math.abs(axes[a].reduce((s, x, i) => s + x * axes[b][i], 0)) > 2e-5,
    )
  )
    throw Error("Parent camera axes must be unit and orthogonal");
}

export async function createLatestParentFrames({
  uc,
  profile,
  image,
  spawnBytes,
  abiBytes,
  cachePackageBytes,
  cacheBytes,
  loadBytes,
  mathPackageBytes,
  loadMathBytes,
  worldFactoryBytes,
  descriptorFactoryBytes,
  drawParameterBytes,
}) {
  const catalogSha = await sha256(cachePackageBytes);
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(abiBytes)) !== PARENT_RUNTIME_SHA ||
    ![
      PARENT_CACHES_SHA,
      PARENT_REQUESTED_CACHES_SHA,
      PARENT_RAY_CACHES_SHA,
      PARENT_DRAW_CACHES_SHA,
    ].includes(catalogSha)
  )
    throw Error("Parent CPU runtime input hash mismatch");
  const abi = decode(abiBytes),
    catalog = decode(cachePackageBytes),
    cache = decode(cacheBytes),
    spawn = decode(spawnBytes),
    digest = await sha256(cacheBytes);
  const ref = catalog.caches.find(
    (r) => r.sha256 === digest && r.effectId === cache.effectId,
  );
  if (
    !ref ||
    catalog.schema !== 1 ||
    catalog.kind !==
      (catalogSha === PARENT_CACHES_SHA
        ? "prepared-native-parent-resource-caches"
        : catalogSha === PARENT_REQUESTED_CACHES_SHA
          ? "prepared-requested-root-parent-caches"
          : catalogSha === PARENT_RAY_CACHES_SHA
            ? "prepared-ray-parent-resource-caches"
            : "prepared-parent-draw-parameter-caches") ||
    catalog.build !== abi.build ||
    catalog.protocol !== abi.protocol ||
    catalog.decoderImageSha256 !== profile.decoderImageSha256 ||
    catalog.scope.containsReplayEvents ||
    catalog.scope.portableBrowserGraphicsHandles ||
    abi.kind !== "prepared-parent-cpu-runtime-abi" ||
    cache.kind !== "initialized-native-parent-resource-cache" ||
    abi.build !== "16.21.829.8620" ||
    abi.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== abi.build ||
    profile.protocolDigest !== abi.protocol ||
    cache.build !== abi.build ||
    cache.protocol !== abi.protocol ||
    abi.parentCachePackageSha256 !== PARENT_CACHES_SHA ||
    abi.decoderImageSha256 !== profile.decoderImageSha256 ||
    cache.decoderImageSha256 !== profile.decoderImageSha256 ||
    cache.scope.containsReplayEvents ||
    cache.scope.portableBrowserGraphicsHandles ||
    !cache.scope.warmParentSuspended ||
    !abi.scope.foreignHostCallbacksMustFail ||
    !Number.isSafeInteger(cache.nextHeap) ||
    cache.nextHeap <= 0x10400000 ||
    cache.nextHeap > 0x12000000 ||
    typeof loadBytes !== "function"
  )
    throw Error("Unsupported parent CPU cache or execution scope");
  const loaded = [],
    addresses = new Set();
  for (const region of [
    ...cache.segments.map((r) => ({ ...r, target: r.address, kind: "owned" })),
    ...cache.imagePatches.map((r) => ({
      ...r,
      target: profile.imageBase + r.rva,
      kind: "image",
    })),
  ]) {
    if (
      !/^[a-z0-9-]+(?:-io-[a-f0-9]+|-image-[a-f0-9]+|-heap)?\.bin$/.test(
        region.file,
      ) ||
      addresses.has(region.target)
    )
      throw Error("Invalid/duplicate parent cache segment");
    const b = new Uint8Array(await loadBytes(region.file));
    if (b.length !== region.bytes || (await sha256(b)) !== region.sha256)
      throw Error("Parent cache segment hash/size mismatch");
    const at = region.target;
    if (region.kind === "image") {
      if (
        region.rva % 4096 ||
        region.rva < 0x1fef000 ||
        region.rva + b.length > image.length ||
        b.length !== 4096
      )
        throw Error(
          "Parent cache attempted to patch executable/out-of-range data",
        );
    } else if (
      !(at === 0x10400000 && b.length === cache.nextHeap - at) &&
      !(
        at >= 0x10000000 &&
        at <= 0x103ff000 &&
        at % 4096 === 0 &&
        b.length === 4096
      )
    )
      throw Error("Parent cache exceeds declared owned IO/heap memory");
    addresses.add(at);
    loaded.push([at, b]);
  }
  if (!addresses.has(0x10400000)) throw Error("Parent cache omits owned heap");
  const math = await loadParentMath(mathPackageBytes, loadMathBytes);
  const worldABI =
    worldFactoryBytes === undefined
      ? null
      : await loadLatestWorldEffectABI(
          worldFactoryBytes,
          profile,
          PARENT_RUNTIME_SHA,
        );
  const descriptorABI =
    descriptorFactoryBytes === undefined
      ? null
      : await loadLatestWorldDescriptorABI(
          descriptorFactoryBytes,
          profile,
          worldABI,
        );
  const drawABI =
    drawParameterBytes === undefined
      ? null
      : await loadParentDrawParameterABI(drawParameterBytes, profile);
  if ((catalogSha === PARENT_DRAW_CACHES_SHA) !== !!drawABI)
    throw Error("Draw parameter caches require their exact optional ABI");
  const kernel = new ParentKernel(
    uc,
    profile,
    image,
    spawn,
    abi,
    math,
    worldABI,
    descriptorABI,
    drawABI,
  );
  try {
    kernel.loadCache(cache, loaded);
    if (drawABI) validateParentDrawCache(kernel, cache);
    return new ParentRuntime(kernel, abi, cache);
  } catch (error) {
    kernel.close();
    throw error;
  }
}

class ParentKernel extends NativeDecoder {
  constructor(
    uc,
    profile,
    image,
    spawn,
    abi,
    math,
    worldABI,
    descriptorABI,
    drawABI,
  ) {
    super(uc, profile, image, { captureWrites: false });
    this.a = spawn.addresses;
    this.base = profile.imageBase;
    this.abi = abi;
    this.worldABI = worldABI;
    this.descriptorABI = descriptorABI;
    this.drawABI = drawABI;
    this.image = image;
    this.mathKernel = installParentMath(uc, this.engine, math, {
      preserveImportRegisters: true,
    });
    this.mathCalls = [];
    this.births = [];
    this.services = {};
    this.hostCalls = [];
    this.allocations = new Map();
    this.nextHeap = 0x10400000;
    this.mathEntries = new Map(
      Object.entries({ ...spawn.mathImports, ...abi.additionalMathImports }),
    );
    this.imports = new Map(
      [...this.mathEntries].map(([name, at]) => [at, name]),
    );
    for (const [name, at] of Object.entries(abi.hostImports))
      this.imports.set(at, name);
    if (worldABI)
      this.imports.set(worldABI.nextPrime.rva, worldABI.nextPrime.symbol);
    if (descriptorABI)
      for (const spec of [
        descriptorABI.sharedImports.lock,
        descriptorABI.sharedImports.releaseWeak,
      ])
        this.imports.set(spec.rva, spec.symbol);
    if (drawABI) this.imports.set(drawABI.memcmp.rva, drawABI.memcmp.symbol);
    const e = this.engine,
      b = this.base,
      admitted = new Set(spawn.services),
      blocks = new Map();
    this.endpoint = null;
    this.endpoints = new Set([
      0x15eaf0a,
      0x1766243,
      ...(drawABI ? [drawABI.prefix[1]] : []),
      ...(descriptorABI
        ? [
            descriptorABI.context.constructor[1],
            descriptorABI.context.identity[1],
          ]
        : []),
    ]);
    // Register once before any code is translated. Readding a hook later can
    // miss a cached successor compiled by the full object propagation path.
    for (const end of this.endpoints)
      e.hook_add(
        uc.HOOK_CODE,
        () => {
          if (this.endpoint === end) e.emu_stop();
        },
        null,
        b + end,
        b + end,
      );
    e.mem_map(0x10400000, 0x1c00000, uc.PROT_ALL);
    e.mem_protect(b + 0x9000, 0x1fef000 - 0x9000, uc.PROT_READ | uc.PROT_EXEC);
    e.hook_add(
      uc.HOOK_BLOCK,
      (_e, address, size) => {
        if (!this.nativeRunning || !Number.isInteger(size) || size <= 0)
          throw Error("Unscoped parent native block");
        const at = Number(address),
          key = `${at}:${size}`;
        let count = blocks.get(key);
        if (count === undefined) {
          const block = e.ctl_request_cache(BigInt(at));
          if (
            Number(block.pc) !== at ||
            block.size !== size ||
            !Number.isInteger(block.icount) ||
            block.icount <= 0 ||
            block.icount > size
          )
            throw Error("Parent native block instruction metadata differs");
          count = block.icount;
          blocks.set(key, count);
        }
        if (this.executionInstructions + count > 5000000) {
          this.executionBudgetExceeded = true;
          e.emu_stop();
          return;
        }
        this.executionInstructions += count;
        this.executionBytes += size;
        this.executionBlocks++;
      },
      null,
      1,
      0,
    );
    const importSet = new Set(spawn.importRvas),
      start = Math.min(...spawn.importRvas),
      end = Math.max(...spawn.importRvas);
    if (importSet.size !== 608 || start !== 0x1fee0c6 || end !== 0x1feef00)
      throw Error("Unexpected parent import range");
    for (const at of admitted)
      if (at < start || at > end)
        e.hook_add(uc.HOOK_CODE, () => this.service(at), null, b + at, b + at);
    e.hook_add(
      uc.HOOK_CODE,
      (_e, address) => {
        const at = Number(address) - b;
        if (!importSet.has(at))
          throw Error("Parent entered a non-import stub byte");
        if (admitted.has(at)) return this.service(at);
        const name = this.imports.get(at);
        if (!name) throw Error(`Unported parent import ${at.toString(16)}`);
        if (
          this.descriptorABI &&
          [
            this.descriptorABI.sharedImports.lock.rva,
            this.descriptorABI.sharedImports.releaseWeak.rva,
          ].includes(at)
        )
          return routeWorldSharedOwnership(this, at);
        if (this.worldABI && at === this.worldABI.nextPrime.rva) {
          const input = this.reg("RDI"),
            result = boundedWorldNextPrime(
              input,
              this.worldABI.nextPrime.maximumInput,
            );
          this.hostCalls.push({ name, input, result });
          e.reg_write_i64(uc.X86_REG_RAX, BigInt(result));
          this.ret();
          return;
        }
        if (this.drawABI && at === this.drawABI.memcmp.rva)
          return routeParentDrawMemcmp(this);
        if (Object.hasOwn(abi.hostImports, name)) return this.host(name);
        if (name === "_modff") {
          const target = this.reg("RDI");
          if (target < this.a.stack - 0x8000 || target > this.a.stack - 4)
            throw Error("Parent modff target outside owned caller stack");
        }
        this.mathCalls.push({
          name,
          x: this.scalar(uc.X86_REG_XMM0),
          y: this.scalar(uc.X86_REG_XMM1),
        });
        return this.mathKernel.route(name);
      },
      null,
      b + start,
      b + end,
    );
    e.hook_add(
      uc.HOOK_CODE,
      () => {
        const at = this.reg("RDI");
        if (at && !this.allocations.has(at))
          throw Error("Unowned parent string free");
        this.hostCalls.push({ name: "owned-string-free", address: at });
        this.ret();
      },
      null,
      b + abi.ownedStringFreeRva,
      b + abi.ownedStringFreeRva,
    );
    for (const patch of profile.modeledServices) {
      if (
        admitted.has(patch.rva) ||
        patch.rva === abi.ownedStringFreeRva ||
        abi.hostImports[patch.service] === patch.rva
      )
        continue;
      e.hook_add(
        uc.HOOK_CODE,
        () => {
          throw Error(
            `Unported parent modeled service ${patch.rva.toString(16)}`,
          );
        },
        null,
        b + patch.rva,
        b + patch.rva + patch.bytesHex.length / 2 - 1,
      );
    }
    const slots = new Map(
      Object.entries(spawn.tls).map(([name, at]) => [b + at, this.a[name]]),
    );
    e.hook_add(
      uc.HOOK_CODE,
      () => {
        const descriptor = this.reg("RDI");
        if (!slots.has(descriptor))
          throw Error("Unowned parent TLS descriptor");
        e.reg_write_i64(uc.X86_REG_RAX, BigInt(slots.get(descriptor)));
      },
      null,
      this.a.tls,
      this.a.tls,
    );
    // Warm-cache metadata contains native host callback addresses. They are
    // deliberately unusable here: returning through their retained RET bytes
    // would silently pretend to create graphics/file resources.
    e.hook_add(
      uc.HOOK_CODE,
      (_e, address, size) => {
        const metadata = this.abi.cachedDeviceMetadata;
        if (Number(address) === metadata.entry) {
          if (
            size !== 1 ||
            this.read(metadata.entry, 1)[0] !== 0xc3 ||
            this.reg("RDI") !== metadata.service ||
            this.q(this.q(metadata.service) + 0x30) !== metadata.entry ||
            this.q(metadata.device) !== metadata.deviceVtable
          )
            throw Error("Unowned cached graphics-device metadata lookup");
          this.hostCalls.push({
            name: "cached-device-metadata",
            device: metadata.device,
          });
          this.engine.reg_write_i64(
            this.uc.X86_REG_RAX,
            BigInt(metadata.device),
          );
          this.ret();
          return;
        }
        if (
          Number(address) !== this.a.tls ||
          size !== 1 ||
          this.read(this.a.tls, 1)[0] !== 0xc3
        )
          throw Error(
            `Unported foreign parent callback ${Number(address).toString(16)}`,
          );
      },
      null,
      0x10000001,
      0x11ffffff,
    );
  }
  reg(name) {
    return Number(this.engine.reg_read_i64(this.uc[`X86_REG_${name}`]));
  }
  put(...a) {
    return NativeVfxSpawnKernel.prototype.put.apply(this, a);
  }
  q(...a) {
    return NativeVfxSpawnKernel.prototype.q.apply(this, a);
  }
  ret(...a) {
    return NativeVfxSpawnKernel.prototype.ret.apply(this, a);
  }
  scalar(...a) {
    return NativeVfxSpawnKernel.prototype.scalar.apply(this, a);
  }
  allocate(...a) {
    return NativeVfxSpawnKernel.prototype.allocate.apply(this, a);
  }
  service(...a) {
    return NativeVfxSpawnKernel.prototype.service.apply(this, a);
  }
  callNative(entry, registers, end = null, scalars = {}) {
    if (this.nativeRunning || this.endpoint !== null)
      throw Error("Reentrant parent native execution");
    if (end !== null && !this.endpoints.has(end))
      throw Error("Unowned parent native fragment endpoint");
    this.endpoint = end;
    try {
      return NativeVfxSpawnKernel.prototype.callNative.call(
        this,
        entry,
        registers,
        end,
        scalars,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw Error(
        `Parent native entry ${entry.toString(16)} failed at RIP ${this.engine.reg_read_i64(this.uc.X86_REG_RIP).toString(16)}: ${message}`,
      );
    } finally {
      this.endpoint = null;
    }
  }
  libraryPointer(at, size) {
    return (
      Number.isSafeInteger(at) &&
      Number.isSafeInteger(size) &&
      size >= 0 &&
      ((at >= 0x10000000 && at <= 0x12000000 - size) ||
        (at >= this.base && at <= this.base + this.image.length - size))
    );
  }
  cstring(at) {
    const result = [];
    for (let i = 0; i < 4096; i++) {
      if (!this.libraryPointer(at + i, 1)) throw Error("Unowned parent string");
      const v = this.read(at + i, 1)[0];
      if (!v) return result;
      result.push(v);
    }
    throw Error("Parent string exceeds owned bound");
  }
  host(name) {
    const first = this.reg("RDI"),
      second = this.reg("RSI"),
      third = this.reg("RDX");
    let result = 0;
    if (name.startsWith("_pthread_mutexattr_")) {
      if (first < this.a.stack - 0x8000 || first > this.a.stack - 8)
        throw Error("Unowned parent mutex attributes");
      if (name === "_pthread_mutexattr_init") {
        if (this.attrs.has(first))
          throw Error("Duplicate parent mutex attributes");
        this.attrs.set(first, 0);
      } else {
        if (!this.attrs.has(first))
          throw Error("Parent mutex attributes not initialized");
        if (name === "_pthread_mutexattr_settype") {
          if (second !== 2) throw Error("Unsupported parent mutex type");
          this.attrs.set(first, 2);
        } else if (name === "_pthread_mutexattr_destroy")
          this.attrs.delete(first);
        else throw Error("Unknown parent mutex attribute operation");
      }
    } else if (
      [
        "_pthread_mutex_init",
        "_pthread_mutex_lock",
        "_pthread_mutex_unlock",
      ].includes(name)
    ) {
      if (name === "_pthread_mutex_init") {
        const owner = [...this.allocations].find(
          ([at, size]) =>
            (size === 0x2c0 && first === at + 0x98) ||
            (size === 0x108 && first === at + 0x10),
        );
        if (
          !owner ||
          this.mutexes.has(first) ||
          (second && !this.attrs.has(second))
        )
          throw Error("Unowned/duplicate parent mutex initialization");
        this.mutexes.set(first, {
          recursive: !!second && this.attrs.get(second) === 2,
          depth: 0,
        });
      } else {
        const mutex = this.mutexes.get(first);
        if (!mutex) throw Error("Unowned parent mutex");
        if (name === "_pthread_mutex_lock") {
          if (mutex.depth && !mutex.recursive)
            throw Error("Parent mutex reentry");
          mutex.depth++;
        } else {
          if (!mutex.depth)
            throw Error("Parent mutex unlock without ownership");
          mutex.depth--;
        }
      }
    } else if (name === "__tlv_atexit") {
      const rva = first - this.base,
        caller = this.q(this.reg("RSP")) - this.base;
      if (
        rva !== this.abi.threadDestructorRva ||
        second !== this.a.stream ||
        third !== this.base ||
        !this.abi.threadDestructorRegistrationSites.includes(caller)
      )
        throw Error("Unowned parent thread destructor");
      this.threadDestructors.push({
        callbackRva: rva,
        object: second,
        dso: third,
        returnRva: caller,
      });
      this.ret();
      return;
    } else if (name === "_memset_pattern16") {
      if (
        third > 0x100000 ||
        first < 0x10000000 ||
        first > 0x12000000 - third ||
        !this.libraryPointer(second, 16)
      )
        throw Error("Parent pattern fill exceeds owned memory");
      const pattern = this.read(second, 16),
        out = new Uint8Array(third);
      for (let i = 0; i < out.length; i++) out[i] = pattern[i % 16];
      if (out.length) this.engine.mem_write(first, out);
    } else if (name === "_strlen") result = this.cstring(first).length;
    else if (name === "_strcmp") {
      const a = [...this.cstring(first), 0],
        b = [...this.cstring(second), 0];
      for (let i = 0; i < Math.min(a.length, b.length); i++)
        if (a[i] !== b[i]) {
          result = a[i] - b[i];
          break;
        }
    } else if (name === "___bzero") {
      if (
        second > 0x100000 ||
        first < 0x10000000 ||
        first > 0x12000000 - second
      )
        throw Error("Parent zero fill exceeds owned memory");
      if (second) this.engine.mem_write(first, new Uint8Array(second));
    } else if (name === "____chkstk_darwin") {
      const count = this.reg("RAX"),
        sp = this.reg("RSP"),
        caller = this.q(sp) - this.base;
      const allowed = new Map([
        [0x1499b00, 0x1028],
        [0x1912040, 0x1028],
        [0x17dc355, 0x1010],
      ]);
      if (
        allowed.get(caller) !== count ||
        sp - count < 0x10008000 ||
        sp > 0x10010008
      )
        throw Error("Parent stack probe exceeds admitted site/bounds");
      for (let at = sp - count; at <= sp; at += 4096) this.read(at, 1);
      result = count;
    } else throw Error("Unported parent host service");
    this.hostCalls.push({ name, first, second, result });
    this.engine.reg_write_i64(
      this.uc.X86_REG_RAX,
      BigInt.asUintN(64, BigInt(result)),
    );
    this.ret();
  }
  close() {
    this.mathKernel.close();
    super.close();
  }
  loadCache(cache, loaded) {
    for (const [at, bytes] of loaded) this.engine.mem_write(at, bytes);
    this.allocations = new Map(cache.allocations);
    this.nextHeap = cache.nextHeap;
    this.attrs = new Map(
      Object.entries(cache.hostAttributes).map(([key, value]) => [
        Number(key),
        value,
      ]),
    );
    this.mutexes = new Map(
      [
        ...Object.entries(cache.hostMutexes.object),
        ...Object.entries(cache.hostMutexes.resource),
      ].map(([key, value]) => [Number(key), structuredClone(value)]),
    );
    this.threadDestructors = structuredClone(cache.threadDestructors);
  }
}

class ParentRuntime {
  #checkpoints = new Map();
  constructor(kernel, abi, cache) {
    this.kernel = kernel;
    this.abi = abi;
    this.cache = cache;
    this.closed = false;
    this.parents = new Map();
    this.substeps = [];
    this.activeTick = null;
    kernel.engine.hook_add(
      kernel.uc.HOOK_CODE,
      () => {
        if (kernel.placementSyncActive)
          throw Error(
            "Placement propagation attempted to advance emitter simulation",
          );
        if (!this.activeTick) return;
        const actor = kernel.reg("RDI");
        if (
          !this.activeTick.actors.some(
            (a) => a.kind === "complex" && a.pointer === actor,
          )
        )
          throw Error("Parent reached an unowned/child emitter");
        this.substeps.push({
          actor,
          time: kernel.scalar(kernel.uc.X86_REG_XMM0),
        });
      },
      null,
      kernel.base + 0x1757f10,
      kernel.base + 0x1757f10,
    );
    kernel.engine.hook_add(
      kernel.uc.HOOK_CODE,
      () => {
        if (kernel.placementSyncActive)
          throw Error(
            "Placement propagation attempted to advance parent simulation",
          );
      },
      null,
      kernel.base + 0x1763220,
      kernel.base + 0x1763220,
    );
  }
  check() {
    if (this.closed) throw Error("Closed parent CPU runtime");
  }
  #idle() {
    this.check();
    const k = this.kernel;
    if (!this.parents.size || this.activeTick || k.nativeRunning)
      throw Error("Parent checkpoint requires live idle owned parents");
    k.mathKernel.assertIdle();
    if ([...k.mutexes.values()].some((m) => m.depth !== 0))
      throw Error("Parent checkpoint cannot retain a locked mutex");
  }
  #captureWorld() {
    this.#idle();
    const k = this.kernel;
    return {
      memory: [
        [0x10000000, k.read(0x10000000, 0x400000)],
        [0x10400000, k.read(0x10400000, k.nextHeap - 0x10400000)],
        [
          k.base + 0x1fef000,
          k.read(k.base + 0x1fef000, k.image.length - 0x1fef000),
        ],
        [0x31000000, k.read(0x31000000, 0x10000)],
      ],
      host: structuredClone({
        allocations: [...k.allocations],
        nextHeap: k.nextHeap,
        attributes: [...k.attrs],
        mutexes: [...k.mutexes],
        threadDestructors: k.threadDestructors,
      }),
      parents: new Map(
        [...this.parents].map(([handle, p]) => [handle, structuredClone(p)]),
      ),
    };
  }
  worldState() {
    const data = this.#captureWorld();
    return {
      memory: data.memory,
      host: { ...data.host, parents: [...data.parents.values()] },
    };
  }
  checkpoint() {
    const data = this.#captureWorld(),
      handle = Object.freeze({});
    this.#checkpoints.set(handle, data);
    return handle;
  }
  restore(handle) {
    this.#idle();
    const data = this.#checkpoints.get(handle);
    if (!data) throw Error("Released or unowned parent checkpoint");
    const k = this.kernel;
    for (const [address, bytes] of data.memory)
      k.engine.mem_write(address, bytes);
    const host = structuredClone(data.host);
    k.allocations = new Map(host.allocations);
    k.nextHeap = host.nextHeap;
    k.attrs = new Map(host.attributes);
    k.mutexes = new Map(host.mutexes);
    k.threadDestructors = host.threadDestructors;
    this.parents = new Map(
      [...data.parents].map(([parent, p]) => [parent, structuredClone(p)]),
    );
    this.substeps = [];
    k.mathCalls = [];
    k.births = [];
    k.hostCalls = [];
  }
  releaseCheckpoint(handle) {
    this.check();
    if (!this.#checkpoints.delete(handle))
      throw Error("Released or unowned parent checkpoint release");
  }
  vector(at, stride, maximum = 4096) {
    const k = this.kernel,
      ptr = k.q(at),
      count = k.readU32(at + 8),
      capacity = k.readU32(at + 12) & 0x7fffffff;
    if (
      count > maximum ||
      count > capacity ||
      (count && !k.libraryPointer(ptr, count * stride))
    )
      throw Error("Parent vector exceeds owned bounds");
    return Array.from({ length: count }, (_, i) => ptr + i * stride);
  }
  supplyClock(clock) {
    const k = this.kernel;
    if (
      !clock ||
      !Array.isArray(clock.ticks) ||
      clock.ticks.length !== 3 ||
      !clock.ticks.every(
        (v) => typeof v === "bigint" && v >= 0n && v < 0x8000000000000000n,
      ) ||
      ![0, 1, 2].includes(clock.mode) ||
      JSON.stringify(clock.timebase) !==
        JSON.stringify(this.cache.clockInput.timebase)
    )
      throw Error("Explicit parent ticks/mode and prepared timebase required");
    k.callNative(0x14db4b0, {});
    const frequency = k.engine.reg_read_i64(k.uc.X86_REG_RAX);
    if (frequency <= 0n || frequency >= 0x8000000000000000n)
      throw Error("Invalid native parent clock frequency");
    k.callNative(0x15eaeac, { RAX: frequency }, 0x15eaf0a);
    const context = k.allocate(0x50),
      selector = k.allocate(0x10);
    k.u64(context + 0x48, selector);
    k.put(selector + 8, [clock.mode], "u8");
    for (let i = 0; i < 3; i++) {
      const wrapper = k.allocate(0x10),
        source = k.allocate(0x38),
        data = k.allocate(8);
      k.u64(wrapper, source);
      k.put(wrapper + 8, [0], "u8");
      k.u64(source + 0x30, data);
      k.u64(data, clock.ticks[i]);
      k.u64(context + 0x10 + i * 8, wrapper);
    }
    k.u64(k.base + 0x246d000, context);
    return context;
  }
  createParent({ seed, clock, placement }) {
    this.check();
    if (typeof seed !== "bigint" || seed < 0n || seed > 0xffffffffffffffffn)
      throw Error("Explicit unsigned parent seed required");
    const k = this.kernel;
    this.supplyClock(clock);
    k.callNative(0x14910e0, { RDI: seed });
    k.callNative(0x174b760, { RDI: k.a.manager, RSI: k.a.definition, RDX: 0 });
    const object = k.reg("RAX");
    if (k.allocations.get(object) !== 0x238)
      throw Error("Native parent object allocation differs");
    for (const at of [0x1767120, 0x1755ea0])
      k.callNative(at, { RDI: object }, null, { XMM0: 1 });
    const initialSetters =
      placement === undefined
        ? undefined
        : applyParentPlacement(k, object, placement, { initial: true });
    k.callNative(0x1765950, { RDI: object });
    k.callNative(0x1765960, { RDI: object });
    const parent = k.q(object + 0x28);
    if (k.allocations.get(parent) !== 0x2c0)
      throw Error("Native parent activation did not construct an owned parent");
    const initialSync =
      placement === undefined
        ? undefined
        : synchronizeParentPlacement(k, object);
    return this.adoptActivatedObject(
      object,
      placement === undefined
        ? {}
        : { initialPlacement: { setters: initialSetters, sync: initialSync } },
    );
  }
  adoptActivatedObject(object, { initialPlacement } = {}) {
    this.check();
    const k = this.kernel;
    if (
      k.allocations.get(object) !== 0x238 ||
      k.q(object + 0x48) !== k.a.definition ||
      [...this.parents.values()].some((p) => p.ownership.object === object)
    )
      throw Error("Activated parent object is foreign or already owned");
    const parent = k.q(object + 0x28);
    if (k.allocations.get(parent) !== 0x2c0)
      throw Error("Activated object has no owned native parent");
    const field = this.abi.rootType.properties.find(
      (p) => p.hash === fnv("complexEmitterDefinitionData"),
    );
    const disabledField = this.abi.emitterType.properties.find(
      (p) => p.hash === fnv("disabled"),
    );
    if (
      disabledField.offset !== 16 ||
      disabledField.type !== 1 ||
      disabledField.mask !== 0
    )
      throw Error("Parent disabled-byte contract differs");
    const definitions = this.vector(k.a.definition + field.offset, 8).map(
        (row) => k.q(row),
      ),
      disabled = [],
      actors = [];
    definitions.forEach((d, i) => {
      const value = k.read(d + 16, 1)[0];
      if (value > 1) throw Error("Nonboolean native disabled field");
      if (value) disabled.push(i);
    });
    for (const [off, kind, allocationBytes] of [
      [0x40, "complex", 0x120],
      [0x60, "animated", 0x280],
    ])
      for (const row of this.vector(parent + off, 8)) {
        const pointer = k.q(row);
        if (
          k.allocations.get(pointer) !== allocationBytes ||
          (kind === "complex" && k.q(pointer) !== parent)
        )
          throw Error("Native actor owner differs");
        const actor = { kind, pointer, allocationBytes };
        if (kind === "complex") {
          const link = k.q(pointer + 8),
            definition = k.q(link + 0x10),
            emitterIndex = definitions.indexOf(definition),
            primitive = k.q(definition + 0x60);
          if (
            emitterIndex < 0 ||
            definitions.lastIndexOf(definition) !== emitterIndex ||
            !k.libraryPointer(primitive, 8)
          )
            throw Error("Parent authored emitter/primitive differs");
          Object.assign(actor, {
            link,
            linkAllocationBytes: k.allocations.get(link),
            definition,
            emitterIndex,
            primitive,
            primitiveVtableRva: k.q(primitive) - k.base,
          });
        }
        actors.push(actor);
      }
    const values = new DataView(k.read(parent + 0x130, 8).buffer),
      initialTime = Math.fround(
        values.getFloat32(0, true) + values.getFloat32(4, true),
      );
    if (!finite(initialTime)) throw Error("Parent native clock is not finite");
    const ownership = {
      object,
      parent,
      actors,
      initialTime,
      nativeDefinitionFieldOffset: field.offset,
      disabledEmitters: disabled,
      nativeDisabledField: disabledField,
      disabledResourceSkipRva: 0x16e9191,
    };
    const handle = Object.freeze({
      effectId: this.cache.effectId,
      object,
      parent,
    });
    this.parents.set(handle, {
      ownership,
      lastTime: initialTime,
      ...(initialPlacement === undefined
        ? {}
        : { initialPlacement: structuredClone(initialPlacement) }),
    });
    return handle;
  }
  owned(handle) {
    this.check();
    const p = this.parents.get(handle);
    if (!p) throw Error("Unowned parent handle");
    return p;
  }
  ownership(handle) {
    return structuredClone(this.owned(handle).ownership);
  }
  initialPlacement(handle) {
    const p = this.owned(handle);
    if (!p.initialPlacement)
      throw Error("Parent was not created with explicit placement");
    return structuredClone(p.initialPlacement);
  }
  setPlacement(handle, pose, { captureState = true } = {}) {
    const p = this.owned(handle),
      k = this.kernel;
    const setters = applyParentPlacement(k, p.ownership.object, pose, {
      captureState,
    });
    const sync = synchronizeParentPlacement(k, p.ownership.object, {
      captureState,
    });
    return { setters, sync };
  }
  state(handle, { captureBytes = true } = {}) {
    if (typeof captureBytes !== "boolean")
      throw Error("Explicit parent state capture mode required");
    const { ownership: p } = this.owned(handle),
      k = this.kernel,
      actors = [];
    for (const [kind, off] of [
      ["complex", 0x40],
      ["animated", 0x60],
    ]) {
      const actual = this.vector(p.parent + off, 8).map((r) => k.q(r)),
        expected = p.actors
          .filter((a) => a.kind === kind)
          .map((a) => a.pointer);
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw Error(
          "Parent actor creation/removal requires another ownership transition",
        );
    }
    for (const a of p.actors) {
      const actorBytes = k.read(a.pointer, a.allocationBytes),
        actorView = new DataView(
          actorBytes.buffer,
          actorBytes.byteOffset,
          actorBytes.byteLength,
        );
      const record = {
        ...a,
        ...(captureBytes ? { bytesHex: hex(actorBytes) } : {}),
      };
      if (a.kind === "complex") {
        if (
          Number(actorView.getBigUint64(0, true)) !== p.parent ||
          Number(actorView.getBigUint64(8, true)) !== a.link ||
          k.q(a.link + 0x10) !== a.definition ||
          k.q(a.definition + 0x60) !== a.primitive ||
          k.q(a.primitive) !== k.base + a.primitiveVtableRva
        )
          throw Error("Parent actor/definition/primitive ownership changed");
        const pool = Number(actorView.getBigUint64(0xa0, true));
        if (k.allocations.get(pool) !== 0xf0)
          throw Error("Parent particle pool owner differs");
        const poolBytes = k.read(pool, 0xf0),
          poolView = new DataView(
            poolBytes.buffer,
            poolBytes.byteOffset,
            poolBytes.byteLength,
          ),
          vectors = {};
        for (const [name, [off, stride]] of Object.entries(VECTORS)) {
          const address = Number(poolView.getBigUint64(off, true)),
            count = poolView.getUint32(off + 8, true),
            capacity = poolView.getUint32(off + 12, true) & 0x7fffffff;
          if (
            count > 4096 ||
            count > capacity ||
            (count && !k.libraryPointer(address, count * stride))
          )
            throw Error("Parent particle vector exceeds owned memory");
          vectors[name] = {
            address,
            count,
            capacity,
            ...(captureBytes
              ? { bytesHex: count ? hex(k.read(address, count * stride)) : "" }
              : {}),
          };
        }
        Object.assign(record, {
          pool,
          ...(captureBytes ? { poolHex: hex(poolBytes) } : {}),
          vectors,
        });
      }
      actors.push(record);
    }
    return {
      ...(captureBytes ? { parentHex: hex(k.read(p.parent, 0x2c0)) } : {}),
      actors,
      ...(captureBytes ? { rngHex: hex(k.read(k.a.stream + 8, 12)) } : {}),
      nextHeap: k.nextHeap,
    };
  }
  completion(handle) {
    const p = this.owned(handle).ownership,
      k = this.kernel;
    const nativeFlags = new DataView(
        k.read(p.parent + 0x2a9, 2).buffer,
      ).getUint16(0, true),
      nativeComplete = !!(nativeFlags & 2);
    if (!nativeComplete) return { nativeFlags, nativeComplete };
    const state = this.state(handle, { captureBytes: false });
    if (
      state.actors.some(
        (a) =>
          a.kind !== "complex" ||
          !(k.read(a.pointer + 0x18, 1)[0] & 1) ||
          a.vectors.life.count !== 0,
      )
    )
      throw Error("Native complete parent retains unfinished actors/particles");
    return { nativeFlags, nativeComplete };
  }
  suspend(handle, suspended) {
    if (typeof suspended !== "boolean")
      throw Error("Explicit parent suspension required");
    const p = this.owned(handle).ownership,
      k = this.kernel,
      actors = p.actors.filter((a) => a.kind === "complex");
    const before = actors.map((a) => k.read(a.pointer + 0x18, 1)[0]);
    k.callNative(0x1767070, { RDI: p.object, RSI: Number(suspended) });
    k.callNative(0x17661c5, { RBX: p.object }, 0x1766243);
    const after = actors.map((a) => k.read(a.pointer + 0x18, 1)[0]);
    if (
      after.some((v, i) => v !== ((before[i] & ~2) | (Number(suspended) << 1)))
    )
      throw Error("Parent suspension omitted/changed an actor");
    return { before, after, suspended };
  }
  advance(handle, time, maxSubsteps, { captureState = true } = {}) {
    if (typeof captureState !== "boolean")
      throw Error("Explicit parent advance capture mode required");
    const p = this.owned(handle),
      k = this.kernel;
    if (
      !finite(time) ||
      Math.fround(time) < p.lastTime ||
      Math.fround(time) > p.lastTime + 30 ||
      !Number.isInteger(maxSubsteps) ||
      maxSubsteps < 1 ||
      maxSubsteps > 20
    )
      throw Error("Parent requires a monotonic clock and bounded substeps");
    this.substeps = [];
    this.activeTick = p.ownership;
    k.mathCalls = [];
    k.births = [];
    try {
      k.callNative(
        0x1763220,
        { RDI: p.ownership.parent, RSI: maxSubsteps },
        null,
        { XMM0: time },
      );
    } finally {
      this.activeTick = null;
    }
    p.lastTime = Math.fround(time);
    return {
      time: p.lastTime,
      substeps: structuredClone(this.substeps),
      ...(captureState ? { state: this.state(handle) } : {}),
    };
  }
  render(handle, camera, { binary = false } = {}) {
    if (typeof binary !== "boolean")
      throw Error("Explicit parent geometry encoding required");
    const p = this.owned(handle),
      k = this.kernel;
    assertParentCamera(camera);
    const state = this.state(handle, { captureBytes: !binary });
    for (const a of state.actors) {
      if (a.kind !== "complex" || !WRITERS.has(a.primitiveVtableRva))
        throw Error(
          "Parent geometry requires another primitive/animated writer",
        );
      if (
        a.vectors.life.count > 1024 ||
        k.q(k.base + a.primitiveVtableRva + 0x28) - k.base !==
          WRITERS.get(a.primitiveVtableRva)[1]
      )
        throw Error("Parent primitive writer/count differs");
    }
    k.put(G.view, camera.position);
    k.put(G.view + 0x24, camera.axis);
    k.put(CAMERA_INPUT, camera.up);
    k.put(CAMERA_INPUT + 0x10, camera.right);
    k.callNative(0x1746290, {
      RDI: CAMERA_CACHE + 0x158,
      RSI: CAMERA_INPUT,
      RDX: CAMERA_INPUT + 0x10,
    });
    k.u64(CAMERA_CACHE, G.view);
    k.u64(k.a.manager + 0x338, CAMERA_CACHE);
    k.put(k.a.manager + 0x340, [1], "u32");
    const draws = [];
    for (const a of state.actors) {
      const [kind, writer] = WRITERS.get(a.primitiveVtableRva),
        count = a.vectors.life.count,
        trail = kind === "camera-trail" || kind === "arbitrary-trail",
        nvMax = count * (trail ? 56 : 112),
        niMax = trail ? Math.max(0, count - 1) * 12 : count * 12;
      k.engine.mem_write(G.context, new Uint8Array(0x3000));
      k.put(G.view, camera.position);
      k.put(G.view + 0x24, camera.axis);
      for (const [off, value] of [
        [0, G.indices],
        [8, G.vertices],
        [0x10, G.draw],
        [0x18, a.pointer],
        [0x20, G.view],
      ])
        k.u64(G.context + off, value);
      const guard = k.engine.hook_add(
        k.uc.HOOK_MEM_WRITE,
        (_e, _access, at, size) => {
          const address = Number(at);
          if (!(
            (address >= G.indices && address + size <= G.indices + niMax) ||
            (address >= G.vertices && address + size <= G.vertices + nvMax)
          ))
            throw Error("Parent writer exceeded owned output");
        },
        null,
        G.indices,
        0x100affff,
      );
      try {
        k.callNative(writer, { RDI: a.primitive, RSI: G.context });
      } finally {
        k.engine.hook_del(guard);
      }
      const nv = k.q(G.context + 8) - G.vertices,
        ni = k.q(G.context) - G.indices;
      if (
        nv < 0 ||
        nv > nvMax ||
        ni < 0 ||
        ni > niMax ||
        nv % 28 ||
        ni % 2 ||
        (!trail && (nv !== nvMax || ni !== niMax))
      )
        throw Error("Parent geometry cursor differs");
      const vertices = k.read(G.vertices, nv),
        indices = k.read(G.indices, ni),
        view = new DataView(indices.buffer);
      for (let i = 0; i < indices.length; i += 2)
        if (view.getUint16(i, true) >= nv / 28)
          throw Error("Parent geometry index exceeds vertices");
      draws.push({
        emitterIndex: a.emitterIndex,
        actor: a.pointer,
        kind,
        particleCount: count,
        ...(binary
          ? { vertices, indices, draw: k.read(G.draw, 16) }
          : {
              verticesHex: hex(vertices),
              indicesHex: hex(indices),
              drawHex: hex(k.read(G.draw, 16)),
            }),
      });
    }
    return draws;
  }
  drawParameters(handle, emitterIndex, inputs, options) {
    const p = this.owned(handle);
    return evaluateParentDrawParameters(
      this.kernel,
      this.cache,
      p.ownership,
      emitterIndex,
      inputs,
      options,
    );
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      for (const d of [...this.kernel.threadDestructors].reverse())
        this.kernel.callNative(d.callbackRva, { RDI: d.object });
    } finally {
      this.parents.clear();
      this.#checkpoints.clear();
      this.kernel.close();
    }
  }
}
