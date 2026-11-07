import { NativeDecoder } from "./native-decoder.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { trailPreviewMath } from "./latest-vfx-trails.mjs";

const addresses = {
  definition: 0x10020000,
  link: 0x10021000,
  actor: 0x10022000,
  system: 0x10023000,
  pool: 0x10024000,
  context: 0x10025000,
  view: 0x10026000,
  draw: 0x10027000,
  primitive: 0x10028000,
  particles: 0x10040000,
  attributes: 0x10080000,
  baseMatrices: 0x10090000,
  multMatrices: 0x100a0000,
  vertices: 0x10100000,
  indices: 0x10140000,
};
const formats = {
  0: { stride: 28, colorOffset: 12, uvOffset: 16, multUvOffset: 24 },
  1: { stride: 40, colorOffset: 20, uvOffset: 24, multUvOffset: 32 },
};
const fromHex = (text) => {
  if (typeof text !== "string" || text.length % 2 || !/^[0-9a-f]*$/.test(text))
    throw Error("Invalid quad bytes");
  return Uint8Array.from(text.match(/../g) ?? [], (n) => parseInt(n, 16));
};
const hex = (bytes) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");

export async function createLatestVfxQuadVertices(
  uc,
  profile,
  image,
  definitionBytes,
  math = trailPreviewMath,
) {
  if (
    (await sha256(definitionBytes)) !== profile.vfxQuadVerticesSha256 ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Quad writer package hash mismatch");
  const definition = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== definition.build ||
    profile.protocolDigest !== definition.protocol ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.decoderImageSha256 !== profile.decoderImageSha256 ||
    definition.vfxTrailsSha256 !== profile.vfxTrailsSha256 ||
    definition.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    definition.writerRva !== 0x1730410 ||
    definition.primitiveVtableRva !== 0x23f20c8 ||
    definition.maximumParticles !== 1024 ||
    definition.stackAddress !== 0x10010008 ||
    JSON.stringify(definition.addresses) !== JSON.stringify(addresses) ||
    JSON.stringify(definition.formats) !== JSON.stringify(formats) ||
    definition.defaultDefinitionHex?.length !== 0x470 * 2 ||
    typeof math?.modff !== "function"
  )
    throw Error("Unsupported quad writer package");
  return new QuadKernel(uc, profile, image, definition, math);
}

class QuadKernel extends NativeDecoder {
  constructor(uc, profile, image, definition, math) {
    super(uc, profile, image, { captureWrites: false });
    this.definition = definition;
    this.math = math;
    this.mathCalls = [];
    this.defaultDefinition = fromHex(definition.defaultDefinitionHex);
    for (const field of definition.initializedGlobals)
      this.engine.mem_write(
        profile.imageBase + field.rva,
        fromHex(field.bytesHex),
      );
    this.engine.hook_add(
      uc.HOOK_CODE,
      (_e, address) => {
        if (Number(address) - profile.imageBase !== 0x1feea6e)
          throw Error("Unadmitted quad import");
        this.modff();
      },
      null,
      profile.imageBase + 0x1fee0c6,
      profile.imageBase + 0x1feef00,
    );
    for (const patch of profile.modeledServices)
      this.engine.hook_add(
        uc.HOOK_CODE,
        () => {
          throw Error(`Unadmitted quad service ${patch.rva.toString(16)}`);
        },
        null,
        profile.imageBase + patch.rva,
        profile.imageBase + patch.rva + patch.bytesHex.length / 2 - 1,
      );
  }
  put(at, values, type = "f32") {
    const width = type === "u8" ? 1 : type === "u16" ? 2 : 4;
    const bytes = new Uint8Array(values.length * width),
      view = new DataView(bytes.buffer);
    values.forEach((v, i) => {
      if (type === "u8") view.setUint8(i, v);
      else if (type === "u16") view.setUint16(i * 2, v, true);
      else if (type === "u32") view.setUint32(i * 4, v, true);
      else view.setFloat32(i * 4, v, true);
    });
    this.engine.mem_write(at, bytes);
  }
  modff() {
    const uc = this.uc,
      e = this.engine,
      x = new DataView(e.reg_read(uc.X86_REG_XMM0, 16).buffer).getFloat32(
        0,
        true,
      );
    const answer = this.math.modff(x);
    if (
      ![answer.fraction, answer.integer].every(
        (n) => typeof n === "number" && Number.isFinite(Math.fround(n)),
      )
    )
      throw Error("Invalid quad modff result");
    const target = Number(e.reg_read_i64(uc.X86_REG_RDI)),
      stack = this.definition.stackAddress;
    if (target < stack - 0x8000 || target > stack - 4)
      throw Error("Quad modff outside owned stack");
    this.put(target, [answer.integer]);
    const result = new Uint8Array(16);
    new DataView(result.buffer).setFloat32(0, answer.fraction, true);
    e.reg_write(uc.X86_REG_XMM0, result);
    this.mathCalls.push({
      name: "_modff",
      x,
      integer: answer.integer,
      result: [answer.fraction],
    });
    const sp = Number(e.reg_read_i64(uc.X86_REG_RSP)),
      ret = new DataView(this.read(sp, 8).buffer).getBigUint64(0, true);
    e.reg_write_i64(uc.X86_REG_RIP, ret);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(sp + 8));
  }
  validate(value) {
    const finite = (n) =>
      typeof n === "number" && Number.isFinite(Math.fround(n));
    const vector = (v, width) =>
      Array.isArray(v) && v.length === width && v.every(finite);
    if (
      !value ||
      !Array.isArray(value.particles) ||
      value.particles.length > 1024 ||
      ![0, 1].includes(value.vertexFormat) ||
      !Number.isInteger(value.baseVertex) ||
      value.baseVertex < 0 ||
      value.baseVertex > 65535 - 4 * value.particles.length ||
      ![0, 1, 2, 4].includes(value.blend) ||
      typeof value.uniformScale !== "boolean" ||
      typeof value.multBound !== "boolean" ||
      !vector(value.modulation, 4) ||
      !vector(value.systemScale, 2) ||
      !vector(value.actorUvOffset, 2) ||
      !vector(value.viewPosition, 3) ||
      !["directionScale", "directionMinScale", "projectionScroll"].every((k) =>
        finite(value[k]),
      )
    )
      throw Error("Invalid quad input");
    for (const p of value.particles)
      if (
        !p ||
        !["position", "basisX", "basisY", "basisZ", "direction"].every((k) =>
          vector(p[k], 3),
        ) ||
        !vector(p.color, 4) ||
        !vector(p.size, 2) ||
        !vector(p.uvOffset, 2) ||
        !finite(p.frame) ||
        !finite(p.aux) ||
        !["baseUV", "multUV"].every((k) => p[k] === null || vector(p[k], 6))
      )
        throw Error("Invalid quad particle data");
    for (const k of ["baseUV", "multUV"])
      if (new Set(value.particles.map((p) => p[k] === null)).size > 1)
        throw Error("Mixed quad UV record presence");
  }
  render(value) {
    this.validate(value);
    const q = addresses,
      e = this.engine,
      uc = this.uc,
      count = value.particles.length,
      stride = formats[value.vertexFormat].stride;
    this.mathCalls = [];
    e.mem_write(q.definition, this.defaultDefinition);
    for (const [name, size] of [
      ["link", 0xf0],
      ["actor", 0x128],
      ["system", 0x2b8],
      ["pool", 0xf0],
      ["context", 0x30],
      ["view", 0x30],
      ["draw", 0x10],
    ])
      e.mem_write(q[name], new Uint8Array(size));
    this.put(q.definition + 0x14, [value.blend], "u8");
    this.put(q.definition + 0xe0, value.modulation);
    const flags = this.readU32(q.definition + 0x2d0);
    this.put(
      q.definition + 0x2d0,
      [value.uniformScale ? flags | 8 : flags & ~8],
      "u32",
    );
    for (const [at, key] of [
      [0x330, "directionScale"],
      [0x334, "directionMinScale"],
      [0x338, "projectionScroll"],
    ])
      this.put(q.definition + at, [value[key]]);
    this.put(q.definition + 0xc8, [0], "u8");
    this.u64(q.link + 0x10, q.definition);
    this.u64(q.link + 0x58, value.multBound ? q.primitive : 0);
    for (const [at, key] of [
      [0xe8, "baseUV"],
      [0xe9, "multUV"],
    ])
      this.put(
        q.link + at,
        [count && value.particles[0][key] !== null ? 1 : 0],
        "u8",
      );
    for (const [at, name] of [
      [0, "system"],
      [8, "link"],
      [0xa0, "pool"],
    ])
      this.u64(q.actor + at, q[name]);
    this.put(q.actor + 0x28, value.actorUvOffset);
    this.put(q.system + 0x150, value.systemScale);
    this.put(q.pool + 0x10, [count], "u32");
    for (const [at, name] of [
      [0x38, "particles"],
      [0x98, "attributes"],
      [0x78, "baseMatrices"],
      [0x88, "multMatrices"],
    ])
      this.u64(q.pool + at, q[name]);
    for (const [at, name] of [
      [0, "indices"],
      [8, "vertices"],
      [0x10, "draw"],
      [0x18, "actor"],
      [0x20, "view"],
    ])
      this.u64(q.context + at, q[name]);
    this.put(q.context + 0x28, [value.vertexFormat], "u8");
    this.put(q.draw, [value.baseVertex], "u16");
    this.put(q.view, value.viewPosition);
    value.particles.forEach((p, i) => {
      const at = q.particles + i * 0xac,
        attr = q.attributes + i * 0x2c;
      e.mem_write(at, new Uint8Array(0xac));
      e.mem_write(attr, new Uint8Array(0x2c));
      for (const [offset, name] of [
        [0x50, "basisX"],
        [0x60, "basisY"],
        [0x70, "basisZ"],
        [0x80, "position"],
        [0x90, "direction"],
      ])
        this.put(at + offset, p[name]);
      this.put(attr, [p.frame]);
      this.put(attr + 4, p.color);
      this.put(attr + 0x14, p.size);
      this.put(attr + 0x20, p.uvOffset);
      this.put(attr + 0x28, [p.aux]);
      for (const [target, key] of [
        ["baseMatrices", "baseUV"],
        ["multMatrices", "multUV"],
      ])
        if (p[key] !== null) this.put(q[target] + i * 24, p[key]);
    });
    if (count) {
      e.mem_write(q.vertices, new Uint8Array(count * 4 * stride).fill(0xa5));
      e.mem_write(q.indices, new Uint8Array(count * 12).fill(0xa5));
    }
    e.context_restore(this.context);
    this.u64(this.definition.stackAddress, 0x10000000);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(this.definition.stackAddress));
    e.reg_write_i64(uc.X86_REG_RDI, BigInt(q.primitive));
    e.reg_write_i64(uc.X86_REG_RSI, BigInt(q.context));
    e.emu_start(this.profile.imageBase + 0x1730410, 0x10000000, 0, 5000000);
    if (Number(e.reg_read_i64(uc.X86_REG_RIP)) !== 0x10000000)
      throw Error("Quad writer instruction bound");
    const nv =
      Number(
        new DataView(this.read(q.context + 8, 8).buffer).getBigUint64(0, true),
      ) - q.vertices;
    const ni =
      Number(
        new DataView(this.read(q.context, 8).buffer).getBigUint64(0, true),
      ) - q.indices;
    if (nv !== count * 4 * stride || ni !== count * 12)
      throw Error("Quad writer output bound");
    return {
      verticesHex: hex(this.read(q.vertices, nv)),
      indicesHex: hex(this.read(q.indices, ni)),
      drawHex: hex(this.read(q.draw, 16)),
      mathCalls: [...this.mathCalls],
    };
  }
}

function half(bits) {
  const sign = bits & 0x8000 ? -1 : 1,
    exponent = (bits >>> 10) & 31,
    mantissa = bits & 1023;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
export function decodeLatestVfxQuadVertices(output, format = 0) {
  const layout = formats[format];
  if (!layout) throw Error("Unknown quad vertex format");
  const bytes = fromHex(output.verticesHex),
    indices = fromHex(output.indicesHex);
  if (bytes.length % layout.stride || indices.length % 2)
    throw Error("Malformed quad buffers");
  const view = new DataView(bytes.buffer),
    iv = new DataView(indices.buffer),
    vertices = [];
  for (let at = 0; at < bytes.length; at += layout.stride) {
    const rgba = view.getUint32(at + layout.colorOffset, true),
      position = [0, 4, 8].map((n) => view.getFloat32(at + n, true));
    const uv = [0, 2].map((n) =>
      half(view.getUint16(at + layout.uvOffset + n, true)),
    );
    const multUv = [0, 2].map((n) =>
      half(view.getUint16(at + layout.multUvOffset + n, true)),
    );
    if (![...position, ...uv, ...multUv].every(Number.isFinite))
      throw Error("Nonfinite decoded quad vertex");
    vertices.push({
      position,
      uv,
      multUv,
      color: [
        (rgba >>> 16) & 255,
        (rgba >>> 8) & 255,
        rgba & 255,
        rgba >>> 24,
      ].map((n) => n / 255),
      packedColor: rgba,
    });
  }
  return {
    vertices,
    indices: Array.from({ length: indices.length / 2 }, (_, i) =>
      iv.getUint16(i * 2, true),
    ),
  };
}
