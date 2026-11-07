import { NativeDecoder } from "./native-decoder.mjs";
import { sha256 } from "./structural-comparison.mjs";

// Supplied math is an explicit boundary; original Darwin libm is unverified.
export const spawnPreviewMath = {
  description:
    "JavaScript transcendental functions rounded to float32; original macOS libm unverified",
  sincosf: (x) => [Math.fround(Math.sin(x)), Math.fround(Math.cos(x))],
  sinf: (x) => Math.fround(Math.sin(x)),
  cosf: (x) => Math.fround(Math.cos(x)),
  sqrtf: (x) => Math.fround(Math.sqrt(x)),
  acosf: (x) => Math.fround(Math.acos(x)),
  atan2f: (x, y) => Math.fround(Math.atan2(x, y)),
  fmodf: (x, y) => Math.fround(x % y),
  powf: (x, y) => Math.fround(x ** y),
};

export async function createLatestVfxSpawn(
  uc,
  profile,
  image,
  definitionBytes,
  graphBytes,
  math,
) {
  if (
    !(
      definitionBytes instanceof ArrayBuffer ||
      definitionBytes instanceof Uint8Array
    ) ||
    !(graphBytes instanceof ArrayBuffer || graphBytes instanceof Uint8Array)
  )
    throw Error("Native spawn requires hashed definition and graph bytes");
  if (
    (await sha256(definitionBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Native spawn package hash mismatch");
  const definition = JSON.parse(new TextDecoder().decode(definitionBytes)),
    graph = JSON.parse(new TextDecoder().decode(graphBytes)),
    graphHash = await sha256(graphBytes),
    reference = definition.templates.find(
      (entry) => entry.sha256 === graphHash,
    );
  if (
    !reference ||
    definition.schema !== 1 ||
    graph.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== definition.build ||
    profile.protocolDigest !== definition.protocol ||
    graph.build !== definition.build ||
    graph.protocol !== definition.protocol ||
    graph.effectId !== reference.effectId ||
    graph.emitterIndex !== reference.emitterIndex ||
    graph.sourceDefinitionSha256 !== reference.sourceDefinitionSha256 ||
    definition.decoderImageSha256 !== profile.decoderImageSha256 ||
    definition.vfxBirthSha256 !== profile.vfxBirthSha256 ||
    definition.vfxValuesSha256 !== profile.vfxValuesSha256 ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    definition.birthRva !== 0x1758a70 ||
    definition.insertRva !== 0x175bac0 ||
    definition.maximumBirthsPerStep !== 1000 ||
    definition.maximumPoolSize !== 4096 ||
    definition.runtimeConstructorBlock[0] !== 0x1756780 ||
    definition.runtimeConstructorBlock[1] !== 0x1756a26 ||
    JSON.stringify(graph.addresses) !== JSON.stringify(definition.addresses) ||
    ![
      "sincosf",
      "sinf",
      "cosf",
      "sqrtf",
      "acosf",
      "atan2f",
      "fmodf",
      "powf",
    ].every((key) => typeof math?.[key] === "function")
  )
    throw Error("Unsupported native spawn graph or runtime");
  return new NativeVfxSpawnKernel(uc, profile, image, definition, graph, math);
}

// Shared low-level executor. Admission factories must validate their own hashed
// graph packages before constructing it; this is not a generic asset loader.
export class NativeVfxSpawnKernel extends NativeDecoder {
  #graphBytes = new WeakMap();
  #blockInstructions = new Map();
  constructor(uc, profile, image, definition, graph, math) {
    super(uc, profile, image, { captureWrites: false });
    this.definition = definition;
    this.graph = graph;
    this.math = math;
    this.a = definition.addresses;
    this.base = profile.imageBase;
    this.engine.mem_map(0x10400000, 0x1c00000, uc.PROT_ALL);
    const e = this.engine,
      b = this.base,
      admitted = new Set(definition.services),
      mathEntries = new Map(
        Object.entries(definition.mathImports).map(([name, at]) => [at, name]),
      );
    this.mathEntries = mathEntries;
    // Recover each translated block's exact instruction count from Unicorn's
    // cache API. Charge the whole block before execution, preserving the five
    // million instruction bound without a callback on every instruction.
    // This pinned build's text/stubs are immutable to emulated writes. Counts
    // for mutable owned code are queried each time rather than cached.
    e.mem_protect(b + 0x9000, 0x1fef000 - 0x9000, uc.PROT_READ | uc.PROT_EXEC);
    e.hook_add(
      uc.HOOK_BLOCK,
      (_engine, address, size) => {
        if (!this.nativeRunning || !Number.isSafeInteger(size) || size <= 0)
          throw Error("Native block outside scoped execution budget");
        const at = Number(address),
          immutable = at >= b + 0x9000 && at + size <= b + 0x1feef06,
          key = `${at}:${size}`;
        let count = immutable ? this.#blockInstructions.get(key) : undefined;
        if (count === undefined) {
          const block = e.ctl_request_cache(BigInt(at));
          if (
            Number(block.pc) !== at ||
            block.size !== size ||
            !Number.isInteger(block.icount) ||
            block.icount <= 0 ||
            block.icount > size
          )
            throw Error(
              `Unicorn block instruction metadata mismatch ${at.toString(16)}:${size}:${JSON.stringify(block, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
            );
          count = block.icount;
          if (immutable) this.#blockInstructions.set(key, count);
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
    const importStart = Math.min(...definition.importRvas),
      importEnd = Math.max(...definition.importRvas),
      imports = new Set(definition.importRvas);
    if (
      imports.size !== 608 ||
      importStart !== 0x1fee0c6 ||
      importEnd !== 0x1feef00
    )
      throw Error("Unexpected native import-stub range");
    for (const at of definition.services)
      if (at < importStart || at > importEnd)
        e.hook_add(uc.HOOK_CODE, () => this.service(at), null, b + at, b + at);
    // The build's 608 contiguous import stubs need one range hook. Hundreds of
    // separate hooks make translating each native block unnecessarily costly.
    // Every entered address still requires explicit service/math admission.
    e.hook_add(
      uc.HOOK_CODE,
      (_engine, address) => {
        const at = Number(address) - b;
        if (admitted.has(at)) this.service(at);
        else {
          if (!imports.has(at) || !mathEntries.has(at))
            throw Error(`Unadmitted spawn import ${at.toString(16)}`);
          this.externalMath(mathEntries.get(at));
        }
      },
      null,
      b + importStart,
      b + importEnd,
    );
    for (const patch of profile.modeledServices) {
      if (admitted.has(patch.rva)) continue;
      e.hook_add(
        uc.HOOK_CODE,
        () => {
          throw Error(`Unadmitted spawn service ${patch.rva.toString(16)}`);
        },
        null,
        b + patch.rva,
        b + patch.rva + patch.bytesHex.length / 2 - 1,
      );
    }
    this.slots = new Map(
      Object.entries(definition.tls).map(([name, at]) => [
        b + at,
        this.a[name],
      ]),
    );
    for (const descriptor of this.slots.keys())
      this.u64(descriptor, this.a.tls);
    e.hook_add(
      uc.HOOK_CODE,
      () => {
        const descriptor = Number(e.reg_read_i64(uc.X86_REG_RDI));
        if (!this.slots.has(descriptor))
          throw Error("Unowned spawn TLS descriptor");
        e.reg_write_i64(uc.X86_REG_RAX, BigInt(this.slots.get(descriptor)));
      },
      null,
      this.a.tls,
      this.a.tls,
    );
    // A real instruction hook bounds the constructor even with cached blocks.
    e.hook_add(
      uc.HOOK_CODE,
      () => e.emu_stop(),
      null,
      b + 0x1756a26,
      b + 0x1756a26,
    );
    e.hook_add(
      uc.HOOK_CODE,
      () => {
        const data = {};
        for (const [name, register, n] of [
          ["birth", uc.X86_REG_RSI, 0xdc],
          ["uv", uc.X86_REG_RDX, 0x20],
          ["multUv", uc.X86_REG_RCX, 0x20],
        ]) {
          const at = Number(e.reg_read_i64(register));
          data[`${name}Hex`] = at ? hex(this.read(at, n)) : null;
        }
        this.births.push(data);
        // Observe, then execute the complete native insertion function.
      },
      null,
      b + definition.insertRva,
      b + definition.insertRva,
    );
  }
  put(address, values, type = "f32") {
    const widths = { f32: 4, u32: 4, u8: 1 },
      bytes = new Uint8Array(values.length * widths[type]),
      view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      if (type === "f32") view.setFloat32(index * 4, value, true);
      else if (type === "u32") view.setUint32(index * 4, value, true);
      else view.setUint8(index, value);
    });
    this.engine.mem_write(address, bytes);
  }
  q(address) {
    return Number(
      new DataView(this.read(address, 8).buffer).getBigUint64(0, true),
    );
  }
  scalar(register) {
    return new DataView(this.engine.reg_read(register, 16).buffer).getFloat32(
      0,
      true,
    );
  }
  ret() {
    const e = this.engine,
      uc = this.uc,
      sp = Number(e.reg_read_i64(uc.X86_REG_RSP)),
      target = this.q(sp);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(sp + 8));
    e.reg_write_i64(uc.X86_REG_RIP, BigInt(target));
  }
  allocate(size) {
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size >= 0x100000 ||
      this.nextHeap + size > 0x12000000
    )
      throw Error("Native spawn allocation bound");
    const at = this.nextHeap;
    this.nextHeap = Math.ceil((at + size) / 16) * 16;
    this.allocations.set(at, size);
    this.engine.mem_write(at, new Uint8Array(size).fill(0xa5));
    return at;
  }
  service(at) {
    const e = this.engine,
      uc = this.uc,
      dest = Number(e.reg_read_i64(uc.X86_REG_RDI)),
      key = `0x${at.toString(16)}`;
    this.services[key] = (this.services[key] ?? 0) + 1;
    if ([0x1474a30, 0x149a2f0, 0x14766c0].includes(at))
      e.reg_write_i64(uc.X86_REG_RAX, BigInt(this.allocate(dest)));
    else if ([0x1474970, 0x149a350].includes(at)) {
      if (dest && !this.allocations.has(dest))
        throw Error("Unowned spawn free");
    } else if (
      [
        0x1fee65a, 0x1fee660, 0x1feea44, 0x1feea4a, 0x1fee666, 0x1feea50,
      ].includes(at)
    ) {
      const source = Number(e.reg_read_i64(uc.X86_REG_RSI)),
        n = Number(e.reg_read_i64(uc.X86_REG_RDX));
      if (
        !Number.isSafeInteger(n) ||
        n < 0 ||
        dest < 0x10000000 ||
        dest > 0x12000000 - n
      )
        throw Error("Spawn copy/set bound");
      if (n)
        e.mem_write(
          dest,
          [0x1fee666, 0x1feea50].includes(at)
            ? new Uint8Array(n).fill(source & 255)
            : this.read(source, n),
        );
      e.reg_write_i64(uc.X86_REG_RAX, BigInt(dest));
    } else if (at === 0x1fee624) e.reg_write_i64(uc.X86_REG_RAX, 1n);
    else if (at === 0x1fee62a) e.mem_write(dest, new Uint8Array([1]));
    else if (at === 0x1fee606) e.reg_write_i64(uc.X86_REG_RAX, 0n);
    else throw Error("Unadmitted spawn service");
    this.ret();
  }
  externalMath(name) {
    const uc = this.uc,
      x = this.scalar(uc.X86_REG_XMM0),
      y = this.scalar(uc.X86_REG_XMM1);
    let integer;
    const result =
      name === "_modff"
        ? (() => {
            const value = this.math.modff(x),
              at = Number(this.engine.reg_read_i64(uc.X86_REG_RDI));
            if (
              at < this.a.stack - 0x8000 ||
              at > this.a.stack - 4 ||
              !Number.isFinite(value.integer)
            )
              throw Error("Emitter modf output outside owned stack");
            integer = Math.fround(value.integer);
            this.put(at, [integer]);
            return [value.fraction];
          })()
        : name === "___sincosf_stret"
          ? this.math.sincosf(x)
          : [this.math[name.slice(1)](x, y)];
    if (
      !Array.isArray(result) ||
      result.length !== (name === "___sincosf_stret" ? 2 : 1) ||
      !result.every(
        (v) => Number.isFinite(v) && Number.isFinite(Math.fround(v)),
      )
    )
      throw Error("Invalid supplied spawn math result");
    const bytes = new Uint8Array(16),
      view = new DataView(bytes.buffer);
    result.forEach((v, i) => view.setFloat32(i * 4, v, true));
    this.engine.reg_write(uc.X86_REG_XMM0, bytes);
    this.mathCalls.push({
      name,
      x,
      ...(integer === undefined ? {} : { integer }),
      result: result.map(Math.fround),
    });
    this.ret();
  }
  enableEmitterMath() {
    if (
      typeof this.math.modff !== "function" ||
      typeof this.math.expf !== "function"
    )
      throw Error("Missing explicit emitter math policy");
    this.mathEntries.set(0x1feea6e, "_modff");
    this.mathEntries.set(0x1fee81c, "_expf");
  }
  callNative(entry, registers, end = null, scalars = {}) {
    const e = this.engine,
      uc = this.uc;
    if (this.nativeRunning) throw Error("Reentrant native spawn execution");
    e.context_restore(this.context);
    this.u64(this.a.stack, this.a.stop);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(this.a.stack));
    for (const [name, value] of Object.entries(registers))
      e.reg_write_i64(uc[`X86_REG_${name}`], BigInt(value));
    for (const [name, value] of Object.entries(scalars)) {
      if (name !== "XMM0" || !finite(value))
        throw Error("Unsupported native scalar argument");
      const bytes = new Uint8Array(16);
      new DataView(bytes.buffer).setFloat32(0, value, true);
      e.reg_write(uc.X86_REG_XMM0, bytes);
    }
    this.executionBytes = 0;
    this.executionBlocks = 0;
    this.executionInstructions = 0;
    this.executionBudgetExceeded = false;
    this.nativeRunning = true;
    try {
      e.emu_start(this.base + entry, this.a.stop, 0, 0);
    } finally {
      this.nativeRunning = false;
      this.lastExecutionBudget = {
        instructions: this.executionInstructions,
        bytes: this.executionBytes,
        blocks: this.executionBlocks,
        maximumInstructions: 5000000,
        exceeded: this.executionBudgetExceeded,
      };
    }
    if (this.executionBudgetExceeded)
      throw Error("Native spawn execution instruction budget exceeded");
    if (
      Number(e.reg_read_i64(uc.X86_REG_RIP)) !==
      (end ? this.base + end : this.a.stop)
    )
      throw Error("Native spawn execution bound");
  }
  reset(seed) {
    if (typeof seed !== "bigint" || seed < 0n || seed > 0xffffffffffffffffn)
      throw Error("Spawn requires an explicit u64 seed");
    const a = this.a,
      b = this.base;
    this.services = {};
    this.births = [];
    this.mathCalls = [];
    let graphBytes = this.#graphBytes.get(this.graph);
    if (!graphBytes) {
      graphBytes = { segments: [], globals: [] };
      for (const segment of this.graph.segments) {
        const bytes = unhex(segment.bytesHex);
        if (
          !Number.isSafeInteger(segment.address) ||
          segment.address < 0x10020000 ||
          segment.address + bytes.length > 0x12000000
        )
          throw Error("Spawn graph segment outside owned memory");
        graphBytes.segments.push({ address: segment.address, bytes });
      }
      for (const segment of this.graph.globals) {
        const bytes = unhex(segment.bytesHex);
        if (segment.rva !== 0x256c9c0 || bytes.length !== 0x180)
          throw Error("Unexpected spawn static initialization");
        graphBytes.globals.push({ rva: segment.rva, bytes });
      }
      // Static admitted graphs are immutable. Keep decoded byte buffers private
      // so repeated instance resets do not parse the same hex data again.
      const freeze = (value) => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          Object.values(value).forEach(freeze);
          Object.freeze(value);
        }
      };
      freeze(this.graph);
      this.#graphBytes.set(this.graph, graphBytes);
    }
    for (const segment of graphBytes.segments)
      this.engine.mem_write(segment.address, segment.bytes);
    for (const segment of graphBytes.globals)
      this.engine.mem_write(b + segment.rva, segment.bytes);
    this.allocations = new Map(this.graph.allocations);
    this.nextHeap = this.graph.nextHeap;
    if (
      !Number.isSafeInteger(this.nextHeap) ||
      this.nextHeap < 0x10400000 ||
      this.nextHeap > 0x12000000
    )
      throw Error("Invalid spawn graph heap");
    this.engine.mem_write(a.tls, new Uint8Array([0xc3]));
    this.u64(b + this.definition.managerPointerRva, a.manager);
    this.u64(a.stream, b + this.definition.rngVtableRva);
    this.u64(a.stream + 8, 1);
    this.put(a.stream + 16, [0], "u32");
    this.put(a.objectReady, [1], "u8");
    this.callNative(
      0x1756780,
      { RDI: a.actor, RSI: a.system, RDX: a.link },
      0x1756a26,
    );
    this.callNative(this.definition.seedRva, { RDI: seed });
    this.poolSize = 0;
    this.ready = true;
  }
  step(input) {
    const a = this.a,
      n = input.count;
    if (
      !this.ready ||
      !Number.isInteger(n) ||
      n < 0 ||
      n > 1000 ||
      this.poolSize + n > 4096 ||
      ![input.previous, input.current].every(
        (v) => Array.isArray(v) && v.length === 3 && v.every(finite),
      ) ||
      ![input.time, input.dt, input.normalizedAge].every(finite) ||
      input.dt < 0 ||
      input.normalizedAge < 0 ||
      input.normalizedAge > 1
    )
      throw Error("Unsupported native spawn step");
    this.births = [];
    this.services = {};
    this.mathCalls = [];
    this.put(a.system + 0xfc, input.previous);
    this.put(a.system + 0x108, input.current);
    this.put(a.context + 0x18, [input.time, input.normalizedAge, 1, input.dt]);
    this.engine.mem_write(a.stack - 0x8000, new Uint8Array(0x8000));
    this.callNative(this.definition.birthRva, {
      RDI: a.actor,
      RSI: a.context,
      RDX: n,
    });
    return this.snapshot();
  }
  snapshot() {
    const a = this.a;
    const pool = this.q(a.actor + 0xa0),
      poolBytes = this.read(pool, 0xf0),
      header = new DataView(
        poolBytes.buffer,
        poolBytes.byteOffset,
        poolBytes.byteLength,
      ),
      vectors = {};
    for (const [name, [offset, stride]] of Object.entries(
      this.definition.vectors,
    )) {
      const pointer = Number(header.getBigUint64(offset, true)),
        count = header.getUint32(offset + 8, true);
      if (
        count > 4096 ||
        (pointer &&
          (pointer < 0x10400000 || pointer > this.nextHeap - count * stride))
      )
        throw Error("Native spawn pool bound");
      vectors[name] = {
        count,
        hex: count ? hex(this.read(pointer, count * stride)) : "",
      };
    }
    this.poolSize = vectors.life.count;
    return {
      births: this.births,
      vectors,
      rngHex: hex(this.read(a.stream + 8, 12)),
      actorHex: hex(this.read(a.actor, 0x128)),
      poolHex: hex(poolBytes),
      services: this.services,
      mathCalls: this.mathCalls,
    };
  }
}
const finite = (value) =>
  Number.isFinite(value) && Number.isFinite(Math.fround(value));
const hex = (bytes) =>
  Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
const unhex = (value) => {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/.test(value))
    throw Error("Invalid native graph bytes");
  return Uint8Array.from(value.match(/../g) ?? [], (v) => parseInt(v, 16));
};
