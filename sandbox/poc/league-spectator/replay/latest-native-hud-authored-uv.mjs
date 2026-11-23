import { NativeVfxSpawnKernel, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { sha256 } from "./structural-comparison.mjs";

const IMAGE_SHA256 =
  "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7";
const SLICE_SHA256 =
  "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b";
const RUNTIME_SHA256 =
  "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716";
const FIELDS = new Set([
  "__type",
  "{f9721a78}",
  "{abb79fd0}",
  "{9f9705c7}",
  "mTextureUV",
]);

// This executes the original single-quad authored UV program. It does not
// admit a controller, nested image atlas, sliced provider or complete HUD.
export async function createLatestNativeHudAuthoredUv({
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
    (await sha256(imageBytes)) !== IMAGE_SHA256 ||
    manifest.schema !== 1 ||
    manifest.kind !== "native-hud-authored-atlas-uv" ||
    manifest.build !== "16.21.829.8620" ||
    manifest.protocol !== "20e09df23c66b85e" ||
    manifest.imageSha256 !== IMAGE_SHA256 ||
    manifest.sliceSha256 !== SLICE_SHA256 ||
    manifest.runtimeSha256 !== RUNTIME_SHA256 ||
    profile.clientVersion !== manifest.build ||
    profile.protocolDigest !== manifest.protocol ||
    profile.decoderImageSha256 !== IMAGE_SHA256 ||
    profile.sliceSha256 !== SLICE_SHA256 ||
    profile.vfxSpawnSha256 !== manifest.vfxSpawnSha256 ||
    (await sha256(spawnBytes)) !== manifest.vfxSpawnSha256 ||
    spawn.runtimeSha256 !== RUNTIME_SHA256 ||
    spawn.build !== manifest.build ||
    spawn.protocol !== manifest.protocol ||
    manifest.constructorRva !== 0x18ef3a0 ||
    manifest.uvFunctionRva !== 0x18a1c70 ||
    manifest.vtableRva !== 0x2404d18 ||
    !Array.isArray(manifest.sourceBlocks) ||
    !manifest.sourceBlocks.length
  )
    throw Error("Unsupported original authored HUD UV package");
  for (const block of manifest.sourceBlocks)
    if (
      !Number.isSafeInteger(block.rva) ||
      !Number.isSafeInteger(block.size) ||
      block.rva < 0 ||
      block.size <= 0 ||
      block.rva > imageBytes.length - block.size ||
      (await sha256(imageBytes.subarray(block.rva, block.rva + block.size))) !==
        block.sha256
    )
      throw Error("Original authored HUD UV program changed");
  const k = new NativeVfxSpawnKernel(
      uc,
      profile,
      imageBytes,
      spawn,
      null,
      spawnPreviewMath,
    ),
    e = k.engine;
  let closed = false;
  const u64 = (address) => {
    const bytes = k.read(address, 8);
    return Number(
      new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ).getBigUint64(0, true),
    );
  };
  const putU32 = (address, value) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    e.mem_write(address, bytes);
  };
  const flagAt = 0x10001000,
    textureOut = 0x10002000,
    uvOut = 0x10003000;
  try {
    e.hook_add(
      uc.HOOK_CODE,
      () => e.emu_stop(),
      null,
      k.base + 0x14aa5f9,
      k.base + 0x14aa5f9,
    );
    k.nextHeap = 0x10400000;
    k.allocations = new Map();
    k.services = {};
    k.births = [];
    k.mathCalls = [];
    k.callNative(0x14aa3bf, {}, 0x14aa5f9);
    k.callNative(manifest.constructorRva, {});
    const owner = Number(e.reg_read_i64(uc.X86_REG_RAX));
    if (
      k.allocations.get(owner) !== 0x38 ||
      u64(owner) !== k.base + manifest.vtableRva ||
      u64(u64(owner) + 5 * 8) !== k.base + manifest.uvFunctionRva
    )
      throw Error("Original authored HUD UV interface changed");
    const defaults = k.read(owner, 0x38);
    return {
      sample(authored, { width, height, controlFlags }) {
        if (closed) throw Error("Closed original authored HUD UV executor");
        if (
          !authored ||
          authored.__type !== "AtlasData" ||
          Object.keys(authored).some((key) => !FIELDS.has(key)) ||
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width <= 0 ||
          height <= 0 ||
          width > 65535 ||
          height > 65535 ||
          ![0, 0x40, 0x80, 0xc0].includes(controlFlags)
        )
          throw Error("Explicit supported authored HUD UV inputs required");
        e.mem_write(owner, defaults);
        for (const [key, offset] of [
          ["{abb79fd0}", 0x10],
          ["{9f9705c7}", 0x14],
        ])
          if (Object.hasOwn(authored, key)) {
            const value = authored[key];
            if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
              throw Error("Invalid authored HUD UV source dimension");
            putU32(owner + offset, value);
          }
        if (Object.hasOwn(authored, "mTextureUV")) {
          const values = authored.mTextureUV;
          if (
            !Array.isArray(values) ||
            values.length !== 4 ||
            !values.every(
              (value) =>
                typeof value === "number" &&
                Number.isFinite(Math.fround(value)),
            )
          )
            throw Error("Invalid authored HUD UV vector");
          k.put(owner + 0x28, values);
        }
        putU32(flagAt, controlFlags);
        k.u64(textureOut, 0);
        k.u64(k.a.stack + 8, textureOut);
        k.u64(k.a.stack + 16, uvOut);
        k.callNative(manifest.uvFunctionRva, {
          RDI: owner,
          RSI: flagAt,
          RDX: width,
          RCX: height,
          R8: width,
          R9: height,
        });
        const bytes = k.read(uvOut, 16),
          view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          values = Array.from({ length: 4 }, (_, index) =>
            view.getFloat32(index * 4, true),
          );
        if (u64(textureOut) !== 0 || !values.every(Number.isFinite))
          throw Error(
            "Original HUD UV execution escaped its admitted owner/value boundary",
          );
        return { bytes, values };
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
