type Vector = [number, number, number];

function cross(a: Vector, b: Vector): Vector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(vector: Vector): Vector | null {
  const length = Math.hypot(...vector);
  return length < 1e-8
    ? null
    : [vector[0] / length, vector[1] / length, vector[2] / length];
}

/** Model face corners wind inward; reverse the cross product for the outward normal. */
export function surfaceNormal(
  corners: readonly [Vector, Vector, Vector, Vector],
): Vector | null {
  const [a, b, c] = corners;
  return unit(
    cross(
      [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    ),
  );
}

/** An orthonormal basis in the actual face plane, including non-cardinal faces. */
export function surfaceTangents(normal: Vector): [Vector, Vector] {
  const reference: Vector = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u = unit(cross(reference, normal));
  if (u === null) throw new Error("invalid surface normal");
  return [u, cross(normal, u)];
}
