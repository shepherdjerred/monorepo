import { NativeVfxSpawnKernel, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { sha256 } from "./structural-comparison.mjs";

const imageSha256 =
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
  sliceSha256 =
    "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b",
  runtimeSha256 =
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  ends = [0x14aa5f9, 0x18abd67, 0x188b567, 0x188b2a6, 0x188b3fc, 0x188b413],
  anchors = {
    AnchorSingle: 0x18ef150,
    AnchorDouble: 0x18ef1e0,
    "{f090d2e7}": 0x18ef290,
  },
  flags = {
    IgnoreGlobalScale: 0x30,
    DisablePixelSnappingX: 0x31,
    DisablePixelSnappingY: 0x32,
    DisableResolutionDownscale: 0x33,
  },
  positionFields = new Set([
    "__type",
    "UIRect",
    "Anchors",
    ...Object.keys(flags),
  ]),
  rectangleFields = new Set([
    "__type",
    "position",
    "Size",
    "SourceResolutionWidth",
    "SourceResolutionHeight",
  ]),
  finite = (value) =>
    typeof value === "number" && Number.isFinite(Math.fround(value)),
  vector = (value) =>
    Array.isArray(value) && value.length === 2 && value.every(finite),
  dimension = (value) =>
    Number.isInteger(value) && value >= 0 && value <= 65535;

function validatePosition(value) {
  if (
    !value ||
    value.__type !== "UiPositionRect" ||
    Object.keys(value).some((key) => !positionFields.has(key))
  )
    throw Error("Unbound original HUD position input");
  if (
    value.UIRect !== undefined &&
    (!value.UIRect ||
      value.UIRect.__type !== "UiElementRect" ||
      Object.keys(value.UIRect).some((key) => !rectangleFields.has(key)))
  )
    throw Error("Original typed HUD rectangle required");
  const rect = value.UIRect;
  if (rect) {
    for (const key of ["position", "Size"])
      if (Object.hasOwn(rect, key) && !vector(rect[key]))
        throw Error("Invalid authored HUD rectangle vector");
    for (const key of ["SourceResolutionWidth", "SourceResolutionHeight"])
      if (Object.hasOwn(rect, key) && !dimension(rect[key]))
        throw Error("Invalid authored HUD source dimension");
  }
  for (const key of Object.keys(flags))
    if (Object.hasOwn(value, key) && typeof value[key] !== "boolean")
      throw Error("Invalid authored HUD flag");
  const anchor = value.Anchors;
  if (anchor !== undefined) {
    if (!anchor || !Object.hasOwn(anchors, anchor.__type))
      throw Error("Unregistered original HUD anchor");
    const allowed =
      anchor.__type === "AnchorSingle" ? ["__type", "Anchor"] : ["__type"];
    if (
      Object.keys(anchor).some((key) => !allowed.includes(key)) ||
      (Object.hasOwn(anchor, "Anchor") && !vector(anchor.Anchor))
    )
      throw Error("Unbound original HUD anchor override");
  }
}

class NativeHudKernel extends NativeVfxSpawnKernel {
  service(at) {
    if (at !== 0x1fee5fa) return super.service(at);
    const dest = Number(this.engine.reg_read_i64(this.uc.X86_REG_RDI)),
      count = Number(this.engine.reg_read_i64(this.uc.X86_REG_RSI)),
      owner = [...this.allocations].find(
        ([start, size]) => start <= dest && dest + count <= start + size,
      );
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count >= 0x100000 ||
      !owner
    )
      throw Error("Original HUD zero-fill escaped its single owned allocation");
    if (count) this.engine.mem_write(dest, new Uint8Array(count));
    this.ret();
  }
}

// Default-settings/root-parent layout executor, not an admission to complete
// spectator HUD support. All geometry comes from the original native program.
export async function createLatestNativeHudLayout({
  uc,
  profile,
  image,
  spawnBytes,
  manifestBytes,
  manifestSha256,
}) {
  const imageBytes =
      image instanceof Uint8Array ? image : new Uint8Array(image),
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
    spawn = JSON.parse(new TextDecoder().decode(spawnBytes));
  if (
    (await sha256(manifestBytes)) !== manifestSha256 ||
    (await sha256(imageBytes)) !== imageSha256 ||
    manifest.schema !== 1 ||
    manifest.kind !== "native-hud-root-layout" ||
    manifest.build !== "16.21.829.8620" ||
    manifest.protocol !== "20e09df23c66b85e" ||
    manifest.imageSha256 !== imageSha256 ||
    manifest.sliceSha256 !== sliceSha256 ||
    manifest.runtimeSha256 !== runtimeSha256 ||
    profile.clientVersion !== manifest.build ||
    profile.protocolDigest !== manifest.protocol ||
    profile.decoderImageSha256 !== imageSha256 ||
    profile.sliceSha256 !== sliceSha256 ||
    profile.vfxSpawnSha256 !== manifest.vfxSpawnSha256 ||
    (await sha256(spawnBytes)) !== manifest.vfxSpawnSha256 ||
    spawn.runtimeSha256 !== runtimeSha256 ||
    spawn.build !== manifest.build ||
    spawn.protocol !== manifest.protocol ||
    JSON.stringify(manifest.anchorConstructors) !== JSON.stringify(anchors) ||
    manifest.layoutRva !== 0x18af630 ||
    manifest.positionConstructorRva !== 0x18fa610 ||
    !Array.isArray(manifest.sourceBlocks) ||
    manifest.sourceBlocks.length < 100
  )
    throw Error("Unsupported original HUD layout package");
  for (const block of manifest.sourceBlocks) {
    if (
      !Number.isSafeInteger(block.rva) ||
      !Number.isSafeInteger(block.size) ||
      block.rva < 0 ||
      block.size <= 0 ||
      block.rva > imageBytes.length - block.size ||
      (await sha256(imageBytes.subarray(block.rva, block.rva + block.size))) !==
        block.sha256
    )
      throw Error("Original HUD layout source block changed");
  }
  const definition = { ...spawn, services: [...spawn.services, 0x1fee5fa] },
    k = new NativeHudKernel(
      uc,
      profile,
      imageBytes,
      definition,
      null,
      spawnPreviewMath,
    ),
    e = k.engine;
  let closed = false;
  const put = (address, type, values) => {
      const width = { f32: 4, u32: 4, u16: 2, u8: 1 }[type],
        bytes = new Uint8Array(width * values.length),
        view = new DataView(bytes.buffer);
      values.forEach((value, index) =>
        view[
          {
            f32: "setFloat32",
            u32: "setUint32",
            u16: "setUint16",
            u8: "setUint8",
          }[type]
        ](index * width, value, true),
      );
      e.mem_write(address, bytes);
    },
    u64 = (address) => {
      const bytes = k.read(address, 8);
      return Number(
        new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).getBigUint64(0, true),
      );
    },
    floats = (address) => {
      const bytes = k.read(address, 16),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Array.from({ length: 4 }, (_, i) => view.getFloat32(i * 4, true));
    },
    call = (entry, registers, end = null) =>
      k.callNative(entry, registers, end),
    position = 0x10080000,
    anchorObject = 0x10090000,
    translation = 0x100a0000,
    parent = 0x100a1000,
    output = 0x100a2000,
    manager = 0x10100000,
    frame = 0x10030000;
  try {
    for (const end of ends)
      e.hook_add(
        uc.HOOK_CODE,
        () => e.emu_stop(),
        null,
        k.base + end,
        k.base + end,
      );
    k.nextHeap = 0x10400000;
    k.allocations = new Map();
    k.services = {};
    k.births = [];
    k.mathCalls = [];
    call(0x14aa3bf, {}, 0x14aa5f9);
    call(0x18fa610, { RDI: position });
    const positionTemplate = k.read(position, 0x48);
    call(0x18abc40, { RDI: 0 }, 0x18abd67);
    const element = Number(e.reg_read_i64(uc.X86_REG_R14)),
      state = element + 0x58;
    if (k.allocations.get(element) !== 0x108)
      throw Error("Original HUD element allocation changed");
    const elementTemplate = k.read(element, 0x108);
    call(0x188b540, { RDI: manager }, 0x188b567);
    const settings = Number(e.reg_read_i64(uc.X86_REG_R14));
    if (k.allocations.get(settings) !== 0x180)
      throw Error("Original HUD settings allocation changed");
    call(0x188b295, { RDI: manager }, 0x188b2a6);
    call(0x188b2cd, { RBX: manager, RBP: frame, R14: 0 }, 0x188b3fc);
    k.u64(frame - 0x60, settings);
    call(0x188b40b, { RBX: manager, RBP: frame }, 0x188b413);
    if (u64(manager) !== k.base + 0x23ffc18 || u64(manager + 0x40) !== settings)
      throw Error("Original HUD settings owner changed");
    const parentGetter = u64(u64(element) + 0x140) - k.base;
    if (parentGetter !== 0x18af4c0)
      throw Error("Original HUD parent getter changed");
    return {
      layout(positions, width, height) {
        if (closed) throw Error("Closed original HUD layout executor");
        if (
          !Array.isArray(positions) ||
          positions.length > 4096 ||
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width <= 0 ||
          height <= 0 ||
          width > 65535 ||
          height > 65535
        )
          throw Error(
            "Bounded original HUD inputs and positive viewport required",
          );
        positions.forEach(validatePosition);
        put(manager + 0xe8, "u32", [width, height]);
        return positions.map((value) => {
          e.mem_write(position, positionTemplate);
          e.mem_write(element, elementTemplate);
          const rect = value.UIRect;
          if (rect) {
            if (Object.hasOwn(rect, "position"))
              put(position + 0x10, "f32", rect.position);
            if (Object.hasOwn(rect, "Size"))
              put(position + 0x18, "f32", rect.Size);
            if (Object.hasOwn(rect, "SourceResolutionWidth"))
              put(position + 0x20, "u16", [rect.SourceResolutionWidth]);
            if (Object.hasOwn(rect, "SourceResolutionHeight"))
              put(position + 0x22, "u16", [rect.SourceResolutionHeight]);
          }
          if (value.Anchors) {
            call(anchors[value.Anchors.__type], { RDI: anchorObject });
            if (value.Anchors.Anchor)
              put(anchorObject + 8, "f32", value.Anchors.Anchor);
            k.u64(position + 0x28, anchorObject);
          }
          for (const [name, offset] of Object.entries(flags))
            if (Object.hasOwn(value, name))
              put(position + offset, "u8", [Number(value[name])]);
          call(0x18b0120, { RDI: state, RSI: position, RDX: element + 0x20 });
          put(translation, "f32", [0, 0]);
          call(parentGetter, { RDI: element, RSI: 1, RDX: parent });
          call(0x18af630, {
            RDI: state,
            RSI: translation,
            RDX: element + 0x20,
            RCX: parent,
            R8: output,
          });
          const result = floats(output);
          if (!result.every(Number.isFinite))
            throw Error("Original HUD layout produced a nonfinite rectangle");
          return result;
        });
      },
      close() {
        if (!closed) {
          closed = true;
          k.close();
        }
      },
    };
  } catch (error) {
    closed = true;
    k.close();
    throw error;
  }
}
