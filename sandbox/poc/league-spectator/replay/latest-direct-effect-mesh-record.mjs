// Original 176-byte static-mesh CPU record (173cb70), not the DX11 208-byte
// ParticleMeshInstanceInfo layout. Facing providers are separate; linked UV
// matrices must come from the verified original UV birth/update pipeline.
const f32 = Math.fround;

function vector(value, length, label) {
  if (
    !(Array.isArray(value) || value instanceof Float32Array) ||
    value.length !== length ||
    !Array.from(value).every(
      (n) =>
        typeof n === "number" && Number.isFinite(n) && Number.isFinite(f32(n)),
    )
  )
    throw new Error(`Invalid mesh record ${label}`);
  return Array.from(value, f32);
}

function byte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new Error(`Invalid mesh record ${label}`);
  return value;
}

function absentFlags(value, length, label) {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    !Array.from(value).every((x) => x === false)
  ) {
    throw new Error(`Unresolved mesh record ${label}`);
  }
}

export function directStaticMeshCpuRecord({
  matrix,
  attributes,
  definitionColor,
  textureDivisions,
  blendByte,
  paletteByte,
  particleIndex,
  facingFlags,
  linkedUvFlags,
  linkedUvMatrices,
}) {
  const world = vector(matrix, 16, "world matrix");
  const color = vector(definitionColor, 4, "definition color");
  const divisions = vector(textureDivisions, 2, "texture divisions");
  byte(blendByte, "blend byte");
  byte(paletteByte, "palette byte");
  absentFlags(facingFlags, 3, "facing provider");
  if (
    !Array.isArray(linkedUvFlags) ||
    linkedUvFlags.length !== 2 ||
    !Array.from(linkedUvFlags).every((v) => typeof v === "boolean") ||
    !Array.isArray(linkedUvMatrices) ||
    linkedUvMatrices.length !== 2
  )
    throw Error("Invalid mesh record linked UV providers");
  const linked = Array.from(linkedUvMatrices, (matrix, index) => {
    if (!linkedUvFlags[index]) {
      if (matrix !== null)
        throw Error("Unexpected mesh record linked UV matrix");
      return null;
    }
    if (matrix === null) throw Error("Unresolved mesh record linked UV matrix");
    return vector(matrix, 6, "linked UV matrix");
  });
  if (!(attributes instanceof Uint8Array) || attributes.length !== 44)
    throw new Error("Invalid mesh record attributes");
  if (
    !Number.isInteger(particleIndex) ||
    particleIndex < 0 ||
    particleIndex > 0xffffffff
  )
    throw new Error("Invalid mesh record particle index");
  const source = new DataView(
    attributes.buffer,
    attributes.byteOffset,
    attributes.byteLength,
  );
  const floats = Array.from({ length: 11 }, (_, i) =>
    source.getFloat32(i * 4, true),
  );
  vector(floats, 11, "attribute values");
  if (floats[0] < -0x80000000 || floats[0] >= 0x80000000)
    throw new Error("Unresolved mesh record frame integer conversion");
  if (divisions.some((n) => n < 0))
    throw new Error("Unresolved mesh record negative texture divisions");
  const result = new Uint8Array(176);
  const out = new DataView(result.buffer);
  const put = (offset, values) =>
    values.forEach((n, i) => out.setFloat32(offset + i * 4, n, true));
  put(0, world);
  put(0x40, [0, 0, 0, 1]);
  out.setUint32(0x5c, particleIndex, true);
  const uv = [0, 0, 0, 0, 0, 0];
  if (divisions[0] !== 0 && divisions[1] !== 0) {
    const frame = Math.trunc(floats[0]);
    const remainder = f32(frame % divisions[0]);
    const row = f32(f32(frame - remainder) / divisions[0]);
    uv[0] = f32(1 / divisions[0]);
    uv[3] = f32(1 / divisions[1]);
    uv[4] = f32(remainder / divisions[0]);
    uv[5] = f32(row / divisions[1]);
  }
  const composedUv = linked.map((matrix) => {
    if (!matrix) return uv;
    // Original 1488fe0: linear 2x2 product, with independently summed offsets.
    const sum = (a, b, c, d) => f32(f32(0 + f32(a * b)) + f32(c * d));
    return [
      sum(matrix[0], uv[0], matrix[1], uv[2]),
      sum(matrix[0], uv[1], matrix[1], uv[3]),
      sum(matrix[2], uv[0], matrix[3], uv[2]),
      sum(matrix[2], uv[1], matrix[3], uv[3]),
      f32(uv[4] + matrix[4]),
      f32(uv[5] + matrix[5]),
    ];
  });
  put(0x60, composedUv[0]);
  put(0x78, composedUv[1]);
  const outputColor = color.map((n, i) => f32(n * floats[1 + i]));
  if ((blendByte & 0xfd) === 0) {
    for (let i = 0; i < 3; i++)
      outputColor[i] = f32(outputColor[i] * outputColor[3]);
    outputColor[3] = 1;
  }
  put(0x90, outputColor);
  // Preserve the original three attribute payload lanes byte-for-byte.
  result.set(attributes.subarray(0x20, 0x2c), 0xa0);
  out.setUint32(
    0xac,
    paletteByte === 3 ? 1 : paletteByte === 4 ? 2 : paletteByte === 5 ? 3 : 0,
    true,
  );
  return result;
}

// Original individual-draw setters 173efd0/173f190/17c1800/148baa0. Projection,
// inverse-world, scene resources and draw mode remain separate explicit inputs.
// Named matrix uniforms are final post-1916f70 bytes; never transpose them again.
export function directStaticMeshDrawParameters({
  record,
  resourceOffset40,
  paletteByte,
  multTexturePresent,
}) {
  if (!(record instanceof Uint8Array) || record.length !== 176)
    throw Error("Original mesh CPU record required");
  if (paletteByte !== 0 || multTexturePresent !== false)
    throw Error("Unresolved mesh palette/mult-texture draw inputs");
  const center = vector(resourceOffset40, 3, "resource center");
  const view = new DataView(
    record.buffer,
    record.byteOffset,
    record.byteLength,
  );
  if (view.getUint32(0xac, true) !== 0)
    throw Error("Mesh record palette provenance disagrees with draw inputs");
  const read = (offset, count) =>
    Array.from({ length: count }, (_, index) =>
      view.getFloat32(offset + index * 4, true),
    );
  const world = vector(read(0, 16), 16, "draw world matrix");
  const uv = vector(read(0x60, 6), 6, "draw UV matrix");
  const color = vector(read(0x90, 4), 4, "draw color");
  const lookup = vector(read(0xa0, 2), 2, "draw color lookup");
  const centerWorld = Array.from({ length: 3 }, (_, lane) =>
    f32(
      f32(
        f32(center[2] * world[8 + lane]) +
          f32(f32(center[0] * world[lane]) + f32(center[1] * world[4 + lane])),
      ) + world[12 + lane],
    ),
  );
  return {
    mWorld: Float32Array.from(
      { length: 16 },
      (_, index) => world[(index % 4) * 4 + Math.floor(index / 4)],
    ),
    kColorFactor: new Float32Array(color),
    vParticleUVTransform: new Float32Array([
      uv[0],
      uv[2],
      uv[4],
      0,
      uv[1],
      uv[3],
      uv[5],
      0,
      0,
      0,
      0,
      0,
    ]),
    COLOR_LOOKUP_UV: new Float32Array([...lookup, 0, 0]),
    DYNAMIC_MESH_CENTER: new Float32Array(centerWorld),
  };
}
