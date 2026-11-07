import { NativeDecoder } from "./native-decoder.mjs";
import { sha256 } from "./structural-comparison.mjs";

// Explicit external math policy; this is not a captured macOS libm implementation.
export const trailPreviewMath = {
  description:
    "JavaScript remainder/atan2/modf with float32 rounding; original macOS libm unverified",
  atan2f: (a, b) => Math.fround(Math.atan2(a, b)),
  fmodf: (a, b) => Math.fround(a % b),
  modff: (a) => {
    const integer = Math.trunc(a);
    return {
      fraction:
        a === integer
          ? a < 0 || Object.is(a, -0)
            ? -0
            : 0
          : Math.fround(a - integer),
      integer: Math.fround(integer),
    };
  },
};

export async function createLatestVfxTrails(
  uc,
  profile,
  image,
  definitionBytes,
  math,
) {
  if (
    !(definitionBytes instanceof ArrayBuffer) &&
    !(definitionBytes instanceof Uint8Array)
  )
    throw Error("Missing hashed trail definition bytes");
  if ((await sha256(definitionBytes)) !== profile.vfxTrailsSha256)
    throw Error("Native trail definition hash mismatch");
  const definition = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== definition.build ||
    profile.protocolDigest !== definition.protocol ||
    definition.writerRva !== 0x1737570 ||
    definition.primitiveVtableRva !== 0x23f6520 ||
    definition.primitiveKind !== 4 ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.decoderImageSha256 !== profile.decoderImageSha256 ||
    (await sha256(image)) !== profile.decoderImageSha256 ||
    definition.maximumPoints !== 1024 ||
    definition.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    JSON.stringify(definition.strides) !==
      JSON.stringify({
        particle: 0xac,
        attributes: 0x2c,
        tiling: 8,
        odometer: 4,
        vertex: 28,
        index: 2,
      }) ||
    !["atan2f", "fmodf", "modff"].every(
      (name) => typeof math?.[name] === "function",
    )
  )
    throw Error("Unsupported native trail writer inputs");
  return new TrailKernel(uc, profile, image, definition, math);
}

class TrailKernel extends NativeDecoder {
  constructor(uc, profile, image, definition, math) {
    super(uc, profile, image, { captureWrites: false });
    this.definition = definition;
    this.math = math;
    this.mathCalls = [];
    const io = NativeDecoder.IO;
    this.addresses = Object.fromEntries(
      Object.entries({
        context: 0x20000,
        definition: 0x21000,
        link: 0x22000,
        actor: 0x23000,
        pool: 0x24000,
        system: 0x25000,
        view: 0x26000,
        primitive: 0x27000,
        manager: 0x28000,
        draw: 0x29000,
        particles: 0x40000,
        attributes: 0x100000,
        tiling: 0x140000,
        odometer: 0x150000,
        indices: 0x160000,
        vertices: 0x180000,
      }).map(([name, offset]) => [name, io + offset]),
    );
    const a = this.addresses,
      base = profile.imageBase,
      e = this.engine;
    for (const initializer of definition.initializedGlobals)
      e.mem_write(
        base + initializer.rva,
        Uint8Array.from(initializer.bytesHex.match(/../g), (x) =>
          parseInt(x, 16),
        ),
      );
    this.u64(base + definition.managerPointerRva, a.manager);
    const mathEntries = new Map(
      Object.entries(definition.mathImports).map(([name, rva]) => [rva, name]),
    );
    for (const patch of profile.modeledServices) {
      if (mathEntries.has(patch.rva)) continue;
      e.hook_add(
        uc.HOOK_CODE,
        () => {
          throw Error(
            `Trail writer entered unadmitted modeled service ${patch.rva.toString(16)}`,
          );
        },
        null,
        base + patch.rva,
        base + patch.rva + patch.bytesHex.length / 2 - 1,
      );
    }
    for (const [rva, name] of mathEntries)
      e.hook_add(
        uc.HOOK_CODE,
        () => this.externalMath(name),
        null,
        base + rva,
        base + rva,
      );
  }
  put(address, values, type = "f32") {
    const bytes = new Uint8Array(values.length * (type === "u8" ? 1 : 4)),
      view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      if (type === "u8") view.setUint8(index, value);
      else if (type === "u32") view.setUint32(index * 4, value, true);
      else view.setFloat32(index * 4, value, true);
    });
    this.engine.mem_write(address, bytes);
  }
  scalar(register) {
    // XMM registers are 128 bits. Scalar register helpers allocate too little.
    return new DataView(this.engine.reg_read(register, 16).buffer).getFloat32(
      0,
      true,
    );
  }
  externalMath(name) {
    const e = this.engine,
      uc = this.uc,
      a = this.scalar(uc.X86_REG_XMM0),
      b = this.scalar(uc.X86_REG_XMM1);
    let result;
    if (name === "modff") {
      const value = this.math.modff(a);
      result = value.fraction;
      const address = Number(e.reg_read_i64(uc.X86_REG_RDI));
      if (
        address < NativeDecoder.STACK ||
        address + 4 > NativeDecoder.STACK + 0x200000
      )
        throw Error("Trail modf output outside owned stack");
      this.put(address, [value.integer]);
    } else result = this.math[name](a, b);
    if (!Number.isFinite(result))
      throw Error(`Nonfinite trail math result: ${name}`);
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setFloat32(0, result, true);
    e.reg_write(uc.X86_REG_XMM0, bytes);
    this.mathCalls.push({ name, a, b, result: Math.fround(result) });
    const stack = Number(e.reg_read_i64(uc.X86_REG_RSP)),
      target = new DataView(this.read(stack, 8).buffer).getBigUint64(0, true);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(stack + 8));
    e.reg_write_i64(uc.X86_REG_RIP, target);
  }
  build(input) {
    const d = this.definition,
      n = input.count,
      a = this.addresses,
      e = this.engine,
      uc = this.uc;
    if (
      !Number.isInteger(n) ||
      n < 0 ||
      n > d.maximumPoints ||
      ![0, 1, 2].includes(input.mode) ||
      ![0, 1].includes(input.smoothingMode) ||
      ![0, 1, 2, 3].includes(input.smoothingQuality) ||
      ![0, 1, 2, 3].includes(input.textureAddressMode) ||
      ![1, 4].includes(input.blendMode)
    )
      throw Error("Unprepared trail configuration");
    const finite = (values) =>
      values.every(
        (value) =>
          Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      );
    for (const [key, width] of [
      ["viewForward", 3],
      ["systemScale", 2],
      ["colorMultiplier", 4],
      ["emitterUv", 2],
    ])
      if (
        !Array.isArray(input[key]) ||
        input[key].length !== width ||
        !finite(input[key])
      )
        throw Error(`Invalid trail ${key}`);
    if (!finite([input.cutoff]) || input.cutoff < 0)
      throw Error("Invalid trail cutoff");
    for (const key of ["particle", "attributes", "tiling", "odometer"]) {
      const bytes = input[`${key}Bytes`],
        target = key === "particle" ? "particles" : key;
      if (!(bytes instanceof Uint8Array) || bytes.length !== n * d.strides[key])
        throw Error(`Invalid native trail ${key} buffer`);
      const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ),
        offsets =
          key === "particle"
            ? [0x80, 0x84, 0x88]
            : Array.from({ length: d.strides[key] / 4 }, (_, i) => i * 4);
      for (let index = 0; index < n; index++)
        for (const offset of offsets)
          if (
            !Number.isFinite(
              view.getFloat32(index * d.strides[key] + offset, true),
            )
          )
            throw Error(`Nonfinite trail ${key} field`);
      e.mem_write(a[target], bytes);
    }
    e.context_restore(this.context);
    e.mem_write(a.context, new Uint8Array(0xa000));
    for (const [offset, address] of [
      [0, a.indices],
      [8, a.vertices],
      [0x10, a.draw],
      [0x18, a.actor],
      [0x20, a.view],
    ])
      this.u64(a.context + offset, address);
    this.u64(a.actor, a.system);
    this.u64(a.actor + 8, a.link);
    this.u64(a.actor + 0xa0, a.pool);
    this.u64(a.link + 0x10, a.definition);
    this.put(a.link + 0x1c, [0xffffffff], "u32");
    this.u64(a.definition + 0x60, a.primitive);
    this.put(a.definition + 0x14, [input.blendMode], "u8");
    this.put(a.definition + 0xc9, [input.textureAddressMode], "u8");
    this.put(a.definition + 0xe0, input.colorMultiplier);
    this.u64(a.primitive, this.profile.imageBase + d.primitiveVtableRva);
    this.put(a.primitive + 8, [4], "u8");
    this.put(a.primitive + 0x28, [input.cutoff]);
    this.put(a.primitive + 0x30, [input.mode, input.smoothingMode], "u8");
    this.put(a.manager + 0x29c, [input.smoothingQuality], "u32");
    this.put(a.system + 0x150, input.systemScale);
    this.put(a.view + 0x24, input.viewForward);
    this.put(a.actor + 0x28, input.emitterUv);
    const countBytes = new Uint8Array(2);
    new DataView(countBytes.buffer).setUint16(0, n, true);
    e.mem_write(a.pool + 0x10, countBytes);
    for (const [offset, address] of [
      [0x38, a.particles],
      [0x98, a.attributes],
      [0xa8, a.tiling],
      [0xb8, a.odometer],
    ])
      this.u64(a.pool + offset, address);
    this.mathCalls = [];
    e.reg_write_i64(uc.X86_REG_RDI, BigInt(a.primitive));
    e.reg_write_i64(uc.X86_REG_RSI, BigInt(a.context));
    this.call(this.profile.imageBase + d.writerRva);
    const indexEnd = Number(
        new DataView(this.read(a.context, 8).buffer).getBigUint64(0, true),
      ),
      vertexEnd = Number(
        new DataView(this.read(a.context + 8, 8).buffer).getBigUint64(0, true),
      ),
      indexBytes = indexEnd - a.indices,
      vertexBytes = vertexEnd - a.vertices;
    if (
      indexBytes < 0 ||
      indexBytes > Math.max(n - 1, 0) * 12 ||
      vertexBytes < 0 ||
      vertexBytes > n * 56 ||
      indexBytes % 2 ||
      vertexBytes % 28
    )
      throw Error("Native trail output exceeded owned buffers");
    return {
      vertices: this.read(a.vertices, vertexBytes),
      indices: this.read(a.indices, indexBytes),
      draw: this.read(a.draw, 16),
      mathCalls: this.mathCalls,
      scope: d.scope,
      mathPolicy: this.math.description,
    };
  }
}
