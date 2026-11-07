import { directCameraTrig } from "./latest-direct-effect-camera-table.mjs";
const f = Math.fround;

// The original cache rotates both supplied axes around right x up. Preserve its
// binary32 operation order, including subtraction of negative matrix terms.
export function directRotateVector(v, axis, sin, cos) {
  const [a, b, c] = axis;
  const aa = f(a * a),
    bb = f(b * b),
    cc = f(c * c);
  const ab = f(a * b),
    ca = f(-c * a),
    cb = f(-c * b);
  const oneCos = f(1 - cos);
  const as = f(a * sin),
    bs = f(b * sin),
    cs = f(c * sin);
  const xx = f(f(cos * f(1 - aa)) + aa);
  const yx = f(f(ab * oneCos) + cs);
  const xy = f(f(ab * oneCos) - cs);
  const yy = f(f(cos * f(1 - bb)) + bb);
  const nzx = f(f(ca * oneCos) + bs);
  const nzy = f(f(cb * oneCos) - as);
  const nxz = f(f(ca * oneCos) - bs);
  const nyz = f(f(cb * oneCos) + as);
  const zz = f(f(f(1 - cc) * cos) + cc);
  return [
    f(f(f(v[0] * xx) + f(v[1] * xy)) - f(v[2] * nxz)),
    f(f(f(v[0] * yx) + f(v[1] * yy)) - f(v[2] * nyz)),
    f(-f(f(f(nzx * v[0]) + f(nzy * v[1])) - f(zz * v[2]))),
  ];
}

export function createDirectCameraCache(camera) {
  const axes = [camera?.right, camera?.up];
  if (
    axes.some(
      (v) =>
        !v ||
        v.length !== 3 ||
        Array.from(v).some((n) => !Number.isFinite(f(n))),
    ) ||
    axes.some(
      (v) =>
        Math.abs(Array.from(v).reduce((s, n) => s + n * n, 0) - 1) > 0.00002,
    ) ||
    Math.abs(axes[0].reduce((s, n, i) => s + n * axes[1][i], 0)) > 0.00002
  )
    throw Error("Direct camera requires unit orthogonal right/up axes");
  const [right, up] = axes.map((v) => Array.from(v, f));
  const axis = [
    f(f(up[2] * right[1]) - f(up[1] * right[2])),
    f(f(up[0] * right[2]) - f(up[2] * right[0])),
    f(f(right[0] * up[1]) - f(up[0] * right[1])),
  ];
  const data = new Float32Array(360 * 6);
  for (let angle = 0; angle < 360; angle++) {
    const sin = directCameraTrig[angle * 2],
      cos = directCameraTrig[angle * 2 + 1];
    data.set(directRotateVector(up, axis, sin, cos), angle * 6);
    data.set(directRotateVector(right, axis, sin, cos), angle * 6 + 3);
  }
  return data;
}

export function directCameraBasis(cache, degrees) {
  // Original cvttss2si truncates before signed modulo, then wraps negatives.
  const value = f(degrees);
  const integer =
    !Number.isFinite(value) || value < -2147483648 || value >= 2147483648
      ? -2147483648
      : Math.trunc(value);
  const angle = ((integer % 360) + 360) % 360;
  return [
    cache.subarray(angle * 6 + 3, angle * 6 + 6),
    cache.subarray(angle * 6, angle * 6 + 3),
  ];
}
