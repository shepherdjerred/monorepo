// Original 16.21.829.8620 setter 0x182bfc0..0x182c004. Its caller obtains
// center/extent from the runtime navigation-cell grid, not the height bounds.
const f = Math.fround;
const vector = (value) =>
  (Array.isArray(value) || value instanceof Float32Array) &&
  value.length === 3 &&
  [0, 1, 2].every(
    (i) =>
      Object.hasOwn(value, i) &&
      typeof value[i] === "number" &&
      Number.isFinite(f(value[i])),
  );

export function directNavgridTransform({ center, extent }) {
  if (
    !vector(center) ||
    !vector(extent) ||
    !(f(extent[0]) > 0) ||
    !(f(extent[2]) > 0)
  )
    throw Error(
      "Explicit finite native navgrid center and positive X/Z extent required",
    );
  const result = new Float32Array(4);
  for (const [lane, axis] of [0, 2].entries()) {
    const size = f(extent[axis]),
      inverse = f(1 / size);
    const offset = f(f(size * f(-0.5)) + f(center[axis]));
    result[lane] = inverse;
    result[lane + 2] = f(f(-offset) * inverse);
  }
  if (!result.every(Number.isFinite))
    throw Error("Native navgrid transform exceeds finite shader coordinates");
  return result;
}
