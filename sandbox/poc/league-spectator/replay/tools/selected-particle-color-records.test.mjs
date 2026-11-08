import { expect, test } from "bun:test";
import { deriveSelectedParticleColorEntry } from "./selected-particle-color-records.mjs";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
function fixture(pixelated = false) {
  const definition = 0x10020000,
    pointer = definition + 0x500,
    path = "ASSETS/Particles/color.tex",
    bytes = new Uint8Array(0x600),
    view = new DataView(bytes.buffer);
  bytes[0x12] = Number(pixelated);
  view.setBigUint64(0xa8, BigInt(pointer), true);
  view.setUint32(0xb0, path.length, true);
  bytes.set(new TextEncoder().encode(path), 0x500);
  return {
    reference: {
      effectId: "fixture/effect",
      emitterIndex: 1,
      sha256: "a".repeat(64),
      sourceDefinitionSha256: "b".repeat(64),
      primitiveKind: "camera",
    },
    graph: {
      addresses: { definition },
      assetObjectHex: bytes.slice(0, 0x500).toHex(),
      segments: [{ address: definition, bytesHex: bytes.toHex() }],
    },
    emitter: {
      particleColorTexture: path,
      ...(pixelated ? { isTexturePixelated: true } : {}),
    },
    asset: {
      kind: "texture",
      status: "prepared",
      file: "textures/color.png",
      sha256: "c".repeat(64),
      sourceSha256: "d".repeat(64),
      width: 32,
      height: 64,
    },
  };
}
test("selected slot1 sampler is derived from original serialized bool and exact authored string", () => {
  for (const pixelated of [false, true]) {
    const input = fixture(pixelated),
      out = deriveSelectedParticleColorEntry(input);
    expect(out.descriptorHex).toBe(pixelated ? "0101010000" : "0101010101");
    expect(out.authoredPath).toBe(input.emitter.particleColorTexture);
    expect(out.nativeSlot).toBe(1);
    expect(out.nativeName).toBe("PARTICLE_COLOR_TEXTURE");
  }
});
test("selected color source/graph/texture corruption cannot become a native record", () => {
  for (const mutate of [
    (x) => (x.emitter.isTexturePixelated = true),
    (x) => (x.emitter.particleColorTexture = "ASSETS/Particles/other.tex"),
    (x) => (x.asset.status = "unsupported"),
    (x) => x.graph.addresses.definition++,
    (x) =>
      (x.graph.segments[0].bytesHex =
        "ff" + x.graph.segments[0].bytesHex.slice(2)),
    (x) =>
      (x.graph.assetObjectHex =
        x.graph.assetObjectHex.slice(0, 0x12 * 2) +
        "02" +
        x.graph.assetObjectHex.slice(0x13 * 2)),
    (x) => (x.emitter.isTexturePixelated = 1),
    (x) => (x.emitter.isTexturePixelated = null),
  ]) {
    const input = fixture();
    mutate(input);
    expect(() => deriveSelectedParticleColorEntry(input)).toThrow();
  }
});
test("selected color validation never invokes supplied source accessors", () => {
  const input = fixture();
  let called = false;
  Object.defineProperty(input.emitter, "isTexturePixelated", {
    enumerable: true,
    get() {
      called = true;
      return false;
    },
  });
  expect(() => deriveSelectedParticleColorEntry(input)).toThrow("Own data");
  expect(called).toBe(false);
});
test("new color packages require the exact fixed native approval, not a caller hash", async () => {
  const bytes = new TextEncoder().encode("{}"),
    sha = () => "0".repeat(64),
    raw = async () => bytes;
  await expect(
    loadNativeParticleColorBindings({ assets: "fixture", raw, sha }),
  ).rejects.toThrow("binding package changed");
  await expect(
    loadNativeParticleColorBindings({
      assets: "fixture",
      raw,
      sha,
      selectedReferenceBytes: bytes,
    }),
  ).rejects.toThrow("binding package changed");
});
