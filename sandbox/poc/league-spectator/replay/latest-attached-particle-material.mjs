// Compose observed static material parameters with a live native pool's draw
// values. Camera, Fresnel, palette and effect scheduling remain separate inputs.
function readVector(hex, values, width) {
  if (
    typeof hex !== "string" ||
    !new RegExp(`^[a-f0-9]{${width * 8}}$`).test(hex) ||
    !Array.isArray(values) ||
    values.length !== width
  )
    throw Error("Invalid attached particle material value");
  const b = Uint8Array.from(hex.match(/../g), (x) => parseInt(x, 16)),
    v = new DataView(b.buffer),
    out = new Float32Array(width);
  for (let i = 0; i < width; i++) {
    out[i] = v.getFloat32(i * 4, true);
    if (!Number.isFinite(out[i]) || !Object.is(out[i], values[i]))
      throw Error("Attached particle material bytes differ");
  }
  return out;
}
export function createAttachedParticleMaterialParameters(material, draw) {
  if (
    !(material?.parameters instanceof Map) ||
    material.parameters.has("kColorFactor") ||
    !draw?.colorFactor
  )
    throw Error("Static attached material and live draw values required");
  const color = readVector(
      draw.colorFactor.bytesHex,
      draw.colorFactor.value,
      4,
    ),
    drive = readVector(draw.erosionDriveHex, [draw.erosionDrive], 1),
    out = new Map();
  for (const [key, value] of material.parameters) {
    if (
      typeof key !== "string" ||
      !(value instanceof Float32Array) ||
      value.length !== 4 ||
      !value.every(Number.isFinite)
    )
      throw Error("Invalid static attached material parameter");
    out.set(key, new Float32Array(value));
  }
  out.set("kColorFactor", color);
  if (out.has("cAlphaErosionParams"))
    out.get("cAlphaErosionParams")[0] = drive[0];
  return out;
}
