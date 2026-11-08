import { NativeDecoder } from "./native-decoder.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { trailPreviewMath } from "./latest-vfx-trails.mjs";
import { spawnPreviewMath } from "./latest-vfx-spawn.mjs";

export const uvAnimationPreviewMath = {
  description:
    "JavaScript modf/sincos rounded to float32; original Darwin libm unverified",
  modff: trailPreviewMath.modff,
  sincosf: spawnPreviewMath.sincosf,
};

export async function createLatestVfxUvAnimation(
  uc,
  profile,
  image,
  definitionBytes,
  math,
) {
  if (
    !(
      definitionBytes instanceof ArrayBuffer ||
      definitionBytes instanceof Uint8Array
    ) ||
    (await sha256(definitionBytes)) !== profile.vfxUvAnimationSha256 ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("UV animation package hash mismatch");
  const definition = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== definition.build ||
    profile.protocolDigest !== definition.protocol ||
    definition.decoderImageSha256 !== profile.decoderImageSha256 ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    definition.vfxUvSha256 !== profile.vfxUvSha256 ||
    definition.vfxBirthSha256 !== profile.vfxBirthSha256 ||
    definition.birthBlock?.join(",") !== "24488910,24489979" ||
    definition.matrixFunctions.base !== 0x175fae0 ||
    definition.matrixFunctions.mult !== 0x175fec0 ||
    definition.integratedPostLoad.floatRva !== 0x177f5b0 ||
    definition.integratedPostLoad.vector2Rva !== 0x177f6e0 ||
    definition.integratedPostLoad.sampleCount !== 64 ||
    typeof math?.modff !== "function" ||
    typeof math?.sincosf !== "function"
  )
    throw Error("Unsupported UV animation package");
  return new UvAnimationKernel(uc, profile, image, definition, math);
}

class UvAnimationKernel extends NativeDecoder {
  #graph;
  #segments;
  #records;
  #particles = new WeakMap();
  #closed = false;
  constructor(uc, profile, image, definition, math) {
    super(uc, profile, image, { captureWrites: false });
    this.definition = definition;
    this.math = math;
    this.mathCalls = [];
    this.a = definition.addresses;
    this.engine.mem_map(0x10400000, 0x100000, uc.PROT_ALL);
    for (const initializer of definition.initializedGlobals)
      this.engine.mem_write(
        profile.imageBase + initializer.rva,
        this.fromHex(initializer.bytesHex),
      );
    const admitted = new Map(
      Object.entries(definition.mathImports).map(([name, at]) => [at, name]),
    );
    if (
      admitted.size !== 2 ||
      admitted.get(0x1feea6e) !== "_modff" ||
      admitted.get(0x1fee66c) !== "___sincosf_stret"
    )
      throw Error("Unexpected UV math imports");
    this.engine.hook_add(
      uc.HOOK_CODE,
      (_engine, address) => {
        const at = Number(address) - profile.imageBase;
        if (!admitted.has(at))
          throw Error(`Unadmitted UV import ${at.toString(16)}`);
        this.externalMath(admitted.get(at));
      },
      null,
      profile.imageBase + 0x1fee0c6,
      profile.imageBase + 0x1feef00,
    );
    for (const patch of profile.modeledServices)
      this.engine.hook_add(
        uc.HOOK_CODE,
        () => {
          throw Error(
            `Unadmitted UV modeled service ${patch.rva.toString(16)}`,
          );
        },
        null,
        profile.imageBase + patch.rva,
        profile.imageBase + patch.rva + patch.bytesHex.length / 2 - 1,
      );
    this.engine.hook_add(
      uc.HOOK_CODE,
      () => this.engine.emu_stop(),
      null,
      profile.imageBase + 0x175affb,
      profile.imageBase + 0x175affb,
    );
  }
  fromHex(text) {
    if (
      typeof text !== "string" ||
      text.length % 2 ||
      !/^[0-9a-f]*$/.test(text)
    )
      throw Error("Invalid UV bytes");
    return Uint8Array.from(text.match(/../g) ?? [], (x) => parseInt(x, 16));
  }
  hex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  put(address, values) {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat32(i * 4, value, true));
    this.engine.mem_write(address, bytes);
  }
  scalar(register) {
    return new DataView(this.engine.reg_read(register, 16).buffer).getFloat32(
      0,
      true,
    );
  }
  scalarWrite(register, values) {
    const bytes = new Uint8Array(16),
      view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat32(i * 4, value, true));
    this.engine.reg_write(register, bytes);
  }
  externalMath(name) {
    const uc = this.uc,
      e = this.engine,
      x = this.scalar(uc.X86_REG_XMM0);
    let result, integer;
    if (name === "_modff") {
      const answer = this.math.modff(x);
      integer = answer.integer;
      result = [answer.fraction];
      if (typeof integer !== "number" || !Number.isFinite(Math.fround(integer)))
        throw Error("Invalid UV modff integer");
      const target = Number(e.reg_read_i64(uc.X86_REG_RDI));
      if (
        target < this.definition.stackAddress - 0x8000 ||
        target > this.definition.stackAddress - 4
      )
        throw Error("UV modff result outside owned stack");
      this.put(target, [integer]);
    } else result = this.math.sincosf(x);
    if (
      !Array.isArray(result) ||
      result.length !== (name === "_modff" ? 1 : 2) ||
      result.some(
        (n) => typeof n !== "number" || !Number.isFinite(Math.fround(n)),
      )
    )
      throw Error("Invalid UV external math");
    this.scalarWrite(uc.X86_REG_XMM0, result);
    this.mathCalls.push({
      name,
      x,
      ...(name === "_modff" ? { integer } : {}),
      result,
    });
    const sp = Number(e.reg_read_i64(uc.X86_REG_RSP));
    const ret = new DataView(this.read(sp, 8).buffer).getBigUint64(0, true);
    e.reg_write_i64(uc.X86_REG_RIP, ret);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(sp + 8));
  }
  async loadGraph(bytes) {
    const hash = await sha256(bytes);
    const reference = this.definition.templates.find((t) => t.sha256 === hash);
    if (!reference) throw Error("Unprepared UV graph");
    const graph = JSON.parse(new TextDecoder().decode(bytes));
    if (
      graph.schema !== 1 ||
      graph.build !== this.definition.build ||
      graph.protocol !== this.definition.protocol ||
      typeof graph.flags?.base !== "boolean" ||
      typeof graph.flags?.mult !== "boolean" ||
      graph.flags.base !== reference.flags.base ||
      graph.flags.mult !== reference.flags.mult
    )
      throw Error("UV graph identity mismatch");
    const segments = graph.segments.map((s) => ({
      address: s.address,
      bytes: this.fromHex(s.bytesHex),
    }));
    const ranges = [];
    for (const s of segments) {
      const end = s.address + s.bytes.length;
      if (
        !Number.isSafeInteger(s.address) ||
        !s.bytes.length ||
        !(
          (s.address >= 0x10020000 && end <= 0x10030000) ||
          (s.address >= 0x10400000 && end <= 0x10500000)
        ) ||
        ranges.some(([a, b]) => s.address < b && end > a)
      )
        throw Error("UV graph memory outside owned ranges");
      ranges.push([s.address, end]);
    }
    this.#graph = graph;
    this.#segments = segments;
    this.#records = null;
    return { flags: { ...graph.flags } };
  }
  restoreGraph() {
    if (!this.#graph) throw Error("Load a UV graph first");
    for (const s of this.#segments) this.engine.mem_write(s.address, s.bytes);
  }
  input(value, keys) {
    for (const name of keys)
      if (
        typeof value?.[name] !== "number" ||
        !Number.isFinite(Math.fround(value[name]))
      )
        throw Error(`Invalid UV input ${name}`);
    if (
      value.chance < 0 ||
      value.chance > 1 ||
      (keys.includes("emitterAge") &&
        (value.emitterAge < 0 || value.emitterAge > 1)) ||
      (keys.includes("age") &&
        (value.age < 0 ||
          value.lifetime < 0 ||
          value.normalizedAge < 0 ||
          value.normalizedAge > 1))
    )
      throw Error("UV input outside admitted range");
  }
  native(entry, registers, scalars = {}, end = null) {
    const uc = this.uc,
      e = this.engine,
      stack = this.definition.stackAddress;
    e.context_restore(this.context);
    this.u64(stack, 0x10000000);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(stack));
    for (const [name, value] of Object.entries(registers))
      e.reg_write_i64(uc[`X86_REG_${name}`], BigInt(value));
    for (const [name, value] of Object.entries(scalars))
      this.scalarWrite(uc[`X86_REG_${name}`], [value]);
    const stop = end === null ? 0x10000000 : this.profile.imageBase + end;
    e.emu_start(this.profile.imageBase + entry, stop, 0, 5000000);
    if (Number(e.reg_read_i64(uc.X86_REG_RIP)) !== stop)
      throw Error("UV native instruction bound");
  }
  birth(value) {
    this.input(value, ["emitterAge", "chance"]);
    this.restoreGraph();
    this.mathCalls = [];
    const frame = this.definition.stackAddress - 0x100;
    this.engine.mem_write(
      this.definition.stackAddress - 0x8000,
      new Uint8Array(0x8000),
    );
    this.put(frame - 0x30, [value.chance, value.emitterAge]);
    this.native(
      0x175abce,
      { RBX: this.a.actor, R14: frame - 0x38, RBP: frame },
      {},
      0x175affb,
    );
    this.#records = {
      base: this.#graph.flags.base ? this.read(frame - 0x70, 0x20) : null,
      mult: this.#graph.flags.mult ? this.read(frame - 0x270, 0x18) : null,
    };
    return {
      records: Object.fromEntries(
        Object.entries(this.#records).map(([k, v]) => [
          k,
          v ? this.hex(v) : null,
        ]),
      ),
      mathCalls: [...this.mathCalls],
    };
  }
  sample(value) {
    this.input(value, ["age", "normalizedAge", "lifetime", "chance"]);
    if (!this.#records) throw Error("Initialize UV birth records first");
    this.restoreGraph();
    this.mathCalls = [];
    const matrices = {};
    for (const group of ["base", "mult"]) {
      if (!this.#records[group]) {
        matrices[group] = null;
        continue;
      }
      const suffix = group === "base" ? "Base" : "Mult";
      const input = this.a[`initial${suffix}`],
        output = this.a[`output${suffix}`];
      this.engine.mem_write(input, this.#records[group]);
      this.engine.mem_write(output, new Uint8Array(24).fill(0xa5));
      this.native(
        this.definition.matrixFunctions[group],
        { RDI: this.a.pool, RSI: input, RDX: 0, RCX: output },
        {
          XMM0: value.age,
          XMM1: value.normalizedAge,
          XMM2: value.lifetime,
          XMM3: value.chance,
        },
      );
      matrices[group] = this.hex(this.read(output, 24));
    }
    return { matrices, mathCalls: [...this.mathCalls] };
  }
  captureParticle() {
    if (this.#closed || !this.#records)
      throw Error("Initialize UV birth records first");
    const handle = Object.freeze({});
    this.#particles.set(handle, {
      graph: this.#graph,
      segments: this.#segments,
      records: this.#records,
    });
    return handle;
  }
  sampleParticle(handle, value) {
    const particle = this.#particles.get(handle);
    if (this.#closed || !particle)
      throw Error("Unknown or released UV particle");
    const previous = {
      graph: this.#graph,
      segments: this.#segments,
      records: this.#records,
    };
    this.#graph = particle.graph;
    this.#segments = particle.segments;
    this.#records = particle.records;
    try {
      return this.sample(value);
    } finally {
      this.#graph = previous.graph;
      this.#segments = previous.segments;
      this.#records = previous.records;
    }
  }
  releaseParticle(handle) {
    if (this.#closed || !this.#particles.delete(handle))
      throw Error("Unknown or released UV particle");
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#particles = new WeakMap();
    super.close();
  }
}
