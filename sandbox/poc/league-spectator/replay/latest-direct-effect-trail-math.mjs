import { directTrailTrig } from "./latest-direct-effect-trail-table.mjs";
import { directRotateVector } from "./latest-direct-effect-camera.mjs";
const f = Math.fround;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === "number" && Number.isFinite(f(n)));
const epsilon = f(1e-5),
  normalizationEpsilon = f(1e-9),
  degrees = f(57.2957763671875);
const sumSquares = ([x, y, z]) => f(f(f(x * x) + f(y * y)) + f(z * z));

export function directTrailAngleRadians(a, b) {
  if (!vector(a) || !vector(b))
    throw Error("Finite direct trail vectors required");
  a = a.map(f);
  b = b.map(f);
  const inverse = f(1 / f(Math.sqrt(f(sumSquares(a) * sumSquares(b)))));
  const dot = f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
  const x = f(dot * inverse),
    pi = f(3.1415927410125732);
  if (x >= 1) return 0;
  if (x <= -1) return pi;
  const u = Math.abs(x),
    root = f(Math.sqrt(f(1 - u)));
  let p = f(f(f(-0.018729299306869507) * u) + f(0.07426100224256516));
  p = f(f(p * u) + f(-0.2121143937110901));
  p = f(f(p * u) + f(1.5707287788391113));
  const angle = f(p * root);
  return x < 0 ? f(pi - angle) : angle;
}

function tableIndex(scaled) {
  if (!Number.isFinite(scaled) || scaled < -2147483648 || scaled >= 2147483648)
    throw Error(
      "Direct trail trig input exceeds verified finite conversion range",
    );
  const integer = Math.trunc(scaled);
  return ((integer % 3600) + 3600) % 3600;
}
export function directTrailSinDegrees(angle) {
  return directTrailTrig[tableIndex(f(f(angle) * 10))];
}
export function directTrailCosDegrees(angle) {
  return directTrailTrig[tableIndex(f(f(90 - f(angle)) * 10))];
}

// Native writer 17380df..1738408, bounded ordinary (mode1) join correction.
// atan2 is an explicit JS/platform control; original macOS libm is uncaptured.
export function directTrailCorrectMode1({
  previousOffset,
  currentOffset,
  width,
  previousWidth,
  segmentLength,
  first = false,
}) {
  if (
    !vector(previousOffset) ||
    !vector(currentOffset) ||
    typeof first !== "boolean" ||
    [width, previousWidth, segmentLength].some(
      (n) => typeof n !== "number" || !Number.isFinite(f(n)),
    )
  )
    throw Error("Finite supplied native trail join inputs required");
  const previous = previousOffset.map(f),
    current = currentOffset.map(f);
  if (
    first ||
    previous.every((v) => Math.abs(v) <= epsilon) ||
    current.every((v) => Math.abs(v) <= epsilon)
  )
    return current;
  const theta = Math.abs(
    f(directTrailAngleRadians(previous, current) * degrees),
  );
  if (theta <= epsilon) return current;
  const length = f(segmentLength),
    w = f(width);
  const limit =
    length > 0
      ? f(f(Math.abs(f(Math.atan2(length, w))) * degrees) / f(2.2))
      : 0;
  const rotation = f(360 - Math.min(limit, theta));
  const axis = [
    f(f(previous[2] * current[1]) - f(current[2] * previous[1])),
    f(f(previous[0] * current[2]) - f(current[0] * previous[2])),
    f(f(current[0] * previous[1]) - f(previous[0] * current[1])),
  ];
  const square = sumSquares(axis);
  if (square > normalizationEpsilon) {
    const scale = f(1 / f(Math.sqrt(square)));
    for (let lane = 0; lane < 3; lane++) axis[lane] = f(axis[lane] * scale);
  }
  const rotated = directRotateVector(
    previous,
    axis,
    directTrailSinDegrees(rotation),
    directTrailCosDegrees(rotation),
  );
  const scale = f(w / f(previousWidth));
  return rotated.map((value) => f(value * scale));
}

export function correctDirectTrailMode1(
  previousOffset,
  currentOffset,
  width,
  previousWidth,
  segmentLength,
) {
  return directTrailCorrectMode1({
    previousOffset,
    currentOffset,
    width,
    previousWidth,
    segmentLength,
  });
}
