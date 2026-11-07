// Original ordinary-static-mesh particle transform (173c0b0/180a0a0).
// This is a supplied-input kernel, not primitive/material admission. Bone,
// billboard, pivot-enabled resource and instance-buffer branches stay explicit.
const f = Math.fround;
const finite = (value) =>
  typeof value === "number" && Number.isFinite(f(value));
const vector = (value, length) =>
  (Array.isArray(value) || value instanceof Float32Array) &&
  value.length === length &&
  Array.from(value).every(finite);
const identity = () =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const translation = (position) => {
  const out = identity();
  out.set(position, 12);
  return out;
};

// Original148bb10 writes right*left in column-major storage. Each product and
// ordered sum is binary32, including the affine zero terms.
function multiply(left, right) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++)
    for (let lane = 0; lane < 4; lane++)
      out[column * 4 + lane] = f(
        f(right[12 + lane] * left[column * 4 + 3]) +
          f(
            f(right[8 + lane] * left[column * 4 + 2]) +
              f(
                f(right[lane] * left[column * 4]) +
                  f(right[4 + lane] * left[column * 4 + 1]),
              ),
          ),
      );
  return out;
}

export function directStaticMeshResourceFields(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 0xe0)
    throw Error("Original 224-byte static mesh resource observation required");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    read = (offset) =>
      Array.from({ length: 3 }, (_, lane) =>
        view.getFloat32(offset + lane * 4, true),
      );
  const fields = {
    offset40: read(0x40),
    offset4c: read(0x4c),
    offset58: read(0x58),
    vector88: read(0x88),
    flag94: view.getUint8(0x94),
  };
  if (
    ![fields.offset40, fields.offset4c, fields.offset58, fields.vector88].every(
      (value) => vector(value, 3),
    ) ||
    ![0, 1].includes(fields.flag94)
  )
    throw Error("Malformed static mesh transform fields");
  return fields;
}

export function directStaticMeshParticleMatrix({
  particleMatrix,
  scale,
  uniformScale,
  systemScale,
  resourceFields,
}) {
  if (
    !vector(particleMatrix, 16) ||
    !vector(scale, 3) ||
    !vector(systemScale, 2) ||
    typeof uniformScale !== "boolean" ||
    !resourceFields ||
    ![
      resourceFields.offset40,
      resourceFields.offset4c,
      resourceFields.offset58,
      resourceFields.vector88,
    ].every((value) => vector(value, 3)) ||
    resourceFields.flag94 !== 0 ||
    [3, 7, 11].some((index) => particleMatrix[index] !== 0) ||
    particleMatrix[15] !== 1
  )
    throw Error(
      "Explicit ordinary static mesh transform inputs required; pivot/bone/facing branches unsupported",
    );
  const position = Array.from(particleMatrix.slice(12, 15), f),
    rotation = Float32Array.from(particleMatrix, f);
  // Original173c528 clears translation before the resource transform.
  rotation.fill(0, 12, 15);
  const shift = position.map((value, lane) =>
      f(value - f(resourceFields.offset40[lane])),
    ),
    lower = shift.map((value, lane) =>
      f(f(resourceFields.offset4c[lane]) + value),
    ),
    upper = shift.map((value, lane) =>
      f(f(resourceFields.offset58[lane]) + value),
    ),
    combinedScale = f(f(systemScale[0]) * f(systemScale[1])),
    scaling = identity();
  for (let lane = 0; lane < 3; lane++)
    scaling[lane * 5] = f(f(scale[uniformScale ? 0 : lane]) * combinedScale);
  let out = multiply(
    translation(upper),
    translation(lower.map((value) => -value)),
  );
  out = multiply(out, scaling);
  out = multiply(out, rotation);
  out = multiply(out, translation(lower));
  return out;
}

// Preserve the original SCB GPU vertex order/bytes. Normals remain mesh-local;
// the selected native shader/material owns their eventual transformation.
export function directStaticMeshGeometry(bytes, triangles) {
  if (
    !(bytes instanceof Uint8Array) ||
    !Number.isInteger(triangles) ||
    triangles <= 0 ||
    bytes.byteLength !== triangles * 108 ||
    bytes.byteLength >= 0x100000
  )
    throw Error("Bounded original static mesh 36-byte vertex buffer required");
  const count = triangles * 3,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    colors = new Uint8Array(count * 4),
    uv = new Float32Array(count * 2);
  for (let index = 0; index < count; index++) {
    for (let lane = 0; lane < 3; lane++) {
      positions[index * 3 + lane] = view.getFloat32(
        index * 36 + lane * 4,
        true,
      );
      normals[index * 3 + lane] = view.getFloat32(
        index * 36 + 12 + lane * 4,
        true,
      );
    }
    for (let lane = 0; lane < 4; lane++)
      colors[index * 4 + lane] = view.getUint8(index * 36 + 24 + lane);
    for (let lane = 0; lane < 2; lane++)
      uv[index * 2 + lane] = view.getFloat32(index * 36 + 28 + lane * 4, true);
  }
  if (
    ![positions, normals, uv].every((value) => Array.from(value).every(finite))
  )
    throw Error("Nonfinite original static mesh vertex fields");
  return {
    vertexCount: count,
    triangles,
    vertexStride: 36,
    positions,
    normals,
    colors,
    uv,
  };
}
