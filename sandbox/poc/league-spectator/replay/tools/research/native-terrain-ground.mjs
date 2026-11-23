export function createNavgridGroundHeight(
  { min, max },
  { columns, rows, step },
  heights,
) {
  if (
    !Number.isSafeInteger(columns) ||
    columns < 2 ||
    !Number.isSafeInteger(rows) ||
    rows < 2 ||
    !(heights instanceof Float32Array) ||
    heights.length !== columns * rows ||
    step.length !== 2 ||
    !step.every((value) => Number.isFinite(value) && value > 0)
  )
    throw new Error("Invalid Map11 navigation surface");

  const f32 = Math.fround;
  return (worldX, worldZ) => {
    const x = f32(worldX);
    const z = f32(worldZ);
    if (!(x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2]))
      return null;
    // The archived Map11 sampler divides in single precision and weights
    // the previous cell by zero at the final row or column.
    const gx = Math.min(f32(f32(x - min[0]) / step[0]), columns - 1);
    const gz = Math.min(f32(f32(z - min[2]) / step[1]), rows - 1);
    const column = Math.min(Math.floor(gx), columns - 2);
    const row = Math.min(Math.floor(gz), rows - 2);
    const u = f32(gx - column);
    const v = f32(gz - row);
    const inverseU = f32(1 - u);
    const inverseV = f32(1 - v);
    const i = row * columns + column;
    const near = f32(f32(heights[i] * inverseU) + f32(heights[i + 1] * u));
    const far = f32(
      f32(heights[i + columns] * inverseU) + f32(heights[i + columns + 1] * u),
    );
    return f32(f32(far * v) + f32(near * inverseV));
  };
}
