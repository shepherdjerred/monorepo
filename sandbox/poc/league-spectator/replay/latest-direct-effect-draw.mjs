import { directPackedColor } from "./latest-direct-effect-math.mjs";

// Compact worker packets become the same attributes consumed by translated
// shaders and offscreen diagnostics. This conversion performs no simulation.
export function directRenderAttributes(draw) {
  if (["camera-trail", "ray"].includes(draw.primitive))
    return directPackedAttributes(draw);
  const vertices = draw.particleCount * 4;
  if (
    !Number.isInteger(draw.particleCount) ||
    draw.particleCount < 0 ||
    !(draw.positions instanceof Float32Array) ||
    draw.positions.length !== vertices * 3 ||
    !(draw.colors instanceof Float32Array) ||
    draw.colors.length !== vertices * 4 ||
    !(draw.uv instanceof Float32Array) ||
    draw.uv.length !== vertices * 2 ||
    !(draw.particleUV instanceof Uint16Array) ||
    draw.particleUV.length !== draw.particleCount * 3 ||
    (draw.multUV !== undefined &&
      (!(draw.multUV instanceof Uint16Array) ||
        (draw.multUV.length !== 8 &&
          draw.multUV.length !== draw.particleCount * 8) ||
        !draw.multUV.every((half) => (half & 0x7c00) !== 0x7c00))) ||
    !draw.particleUV.every((half, index) =>
      index % 3 === 2
        ? half === 0x3c00
        : half <= (index % 3 === 0 ? 0x4400 : 0x3c00),
    ) ||
    !(draw.indices instanceof Uint16Array) ||
    draw.indices.length !== draw.particleCount * 6 ||
    !draw.positions.every(Number.isFinite) ||
    !draw.colors.every(Number.isFinite) ||
    !draw.indices.every((i) => i < vertices)
  )
    throw Error("Malformed direct draw buffers");
  const color = new Uint8Array(vertices * 4),
    uv = new Uint16Array(vertices * 4),
    uv1 = new Uint16Array(vertices * 2);
  for (let i = 0; i < vertices; i++) {
    color.set(
      directPackedColor(Array.from(draw.colors.subarray(i * 4, i * 4 + 4))),
      i * 4,
    );
    for (let lane = 0; lane < 2; lane++) {
      const value = draw.uv[i * 2 + lane];
      // Atlas frame and palette coordinates have separate native half lanes.
      // Authored corner transforms remain outside the compiler's admission.
      if (value !== 0 && value !== 1)
        throw Error("Unadmitted direct UV transform");
      uv[i * 4 + lane] = value === 0 ? 0 : 0x3c00;
    }
    const particle = Math.floor(i / 4);
    const multAt = draw.multUV?.length === 8 ? (i % 4) * 2 : i * 2;
    uv[i * 4 + 2] = draw.particleUV[particle * 3];
    // The original writer selects actual multiply coordinates only while that
    // texture is bound. Other materials retain their particle palette lanes.
    uv1[i * 2] = draw.multUV?.[multAt] ?? draw.particleUV[particle * 3 + 1];
    uv1[i * 2 + 1] =
      draw.multUV?.[multAt + 1] ?? draw.particleUV[particle * 3 + 2];
  }
  return {
    a_POSITION: draw.positions,
    a_COLOR: color,
    a_TEXCOORD: uv,
    a_TEXCOORD1: uv1,
    index: draw.indices,
  };
}

function directPackedAttributes(draw) {
  const ray = draw.primitive === "ray";
  const count = draw.particleCount * (ray ? 4 : 2);
  if (
    !Number.isInteger(draw.particleCount) ||
    draw.particleCount < 1 ||
    draw.particleCount > 1024 ||
    !(draw.vertexBytes instanceof Uint8Array) ||
    draw.vertexBytes.length !== count * 28 ||
    !(draw.indices instanceof Uint16Array) ||
    draw.indices.length !==
      (ray ? draw.particleCount : Math.max(draw.particleCount - 1, 0)) * 6 ||
    !draw.indices.every((i) => i < count)
  )
    throw Error(`Malformed direct ${ray ? "ray" : "trail"} draw buffers`);
  const positions = new Float32Array(count * 3),
    colors = new Uint8Array(count * 4),
    uv = new Uint16Array(count * 4),
    uv1 = new Uint16Array(count * 2),
    view = new DataView(
      draw.vertexBytes.buffer,
      draw.vertexBytes.byteOffset,
      draw.vertexBytes.byteLength,
    );
  for (let i = 0; i < count; i++) {
    for (let lane = 0; lane < 3; lane++)
      positions[i * 3 + lane] = view.getFloat32(i * 28 + lane * 4, true);
    colors.set(draw.vertexBytes.subarray(i * 28 + 12, i * 28 + 16), i * 4);
    for (let lane = 0; lane < 4; lane++)
      uv[i * 4 + lane] = view.getUint16(i * 28 + 16 + lane * 2, true);
    for (let lane = 0; lane < 2; lane++)
      uv1[i * 2 + lane] = view.getUint16(i * 28 + 24 + lane * 2, true);
  }
  if (!positions.every(Number.isFinite))
    throw Error(`Nonfinite direct ${ray ? "ray" : "trail"} draw geometry`);
  return {
    a_POSITION: positions,
    a_COLOR: colors,
    a_TEXCOORD: uv,
    a_TEXCOORD1: uv1,
    index: draw.indices,
  };
}

export function directGeometryBuffers(draw) {
  if (["camera-trail", "ray"].includes(draw.primitive)) {
    directPackedAttributes(draw);
    return {
      vertices: draw.vertexBytes.slice(),
      indices: new Uint8Array(
        draw.indices.buffer,
        draw.indices.byteOffset,
        draw.indices.byteLength,
      ).slice(),
    };
  }
  const a = directRenderAttributes(draw),
    count = a.a_POSITION.length / 3;
  const vertices = new Uint8Array(count * 28),
    view = new DataView(vertices.buffer);
  for (let i = 0; i < count; i++) {
    for (let lane = 0; lane < 3; lane++)
      view.setFloat32(i * 28 + lane * 4, a.a_POSITION[i * 3 + lane], true);
    vertices.set(a.a_COLOR.subarray(i * 4, i * 4 + 4), i * 28 + 12);
    for (let lane = 0; lane < 4; lane++)
      view.setUint16(i * 28 + 16 + lane * 2, a.a_TEXCOORD[i * 4 + lane], true);
    for (let lane = 0; lane < 2; lane++)
      view.setUint16(i * 28 + 24 + lane * 2, a.a_TEXCOORD1[i * 2 + lane], true);
  }
  return {
    vertices,
    indices: new Uint8Array(
      a.index.buffer,
      a.index.byteOffset,
      a.index.byteLength,
    ).slice(),
  };
}
