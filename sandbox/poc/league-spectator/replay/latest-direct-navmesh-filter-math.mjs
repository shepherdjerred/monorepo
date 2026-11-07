const f = Math.fround;
const scalar = (n) => {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw Error("Finite navmesh float32 input required");
  return f(n);
};
const parameters = (v) => {
  if (
    !Array.isArray(v) ||
    v.length !== 4 ||
    Reflect.ownKeys(v).length !== 5 ||
    ![0, 1, 2, 3].every((i) => Object.hasOwn(v, i))
  )
    throw Error("Four dense navmesh parameters required");
  return v.map(scalar);
};

// Original manager constructor7400e3..f7: [manager+18,+1c,+20].
export const DIRECT_NAVMESH_FILTER_DEFAULTS = Object.freeze({
  centerWeight: 0.2225489318370819, // 3e63e3de
  sideWeight: 0.38872551918029785, // 3ec70708
  radius: 1.4584295749664307, // 3fbaadd2
});

// Original740cef..740d1b. Fade rates are static image constants, not the blur
// weights at manager+18/+1c. Clock ownership/last-update transitions are external.
export function directNavmeshFadeParameters(now, lastUpdate) {
  const elapsed = scalar(f(scalar(now) - scalar(lastUpdate)));
  return [scalar(f(elapsed * f(1.2))), scalar(f(elapsed * 0.5)), 0, f(1.1)];
}

// Original7414ba..7414ee and741565..741580. Width/height come from the owned
// source texture uint32 dimensions, converted to float32 before division.
export function directNavmeshBlurParameters(width, height, values) {
  for (const n of [width, height])
    if (!Number.isInteger(n) || n <= 0 || n > 0xffffffff)
      throw Error("Positive uint32 navmesh texture dimensions required");
  if (
    values === null ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Reflect.ownKeys(values).length !== 3 ||
    !["radius", "centerWeight", "sideWeight"].every((k) =>
      Object.hasOwn(values, k),
    )
  )
    throw Error("Explicit owned navmesh manager filter fields required");
  const radius = scalar(values.radius),
    center = scalar(values.centerWeight),
    side = scalar(values.sideWeight);
  return {
    horizontal: [scalar(f(radius / f(width))), 0, center, side],
    vertical: [0, scalar(f(radius / f(height))), center, side],
  };
}

// Translated Regions/Fade.ps branch order. Texture sampling, target construction
// and render-target R8 quantization are separate resource contracts.
export function directNavmeshFadeSample(current, target, value) {
  current = scalar(current);
  target = scalar(target);
  const [increase, decrease, , threshold] = parameters(value);
  return target >= threshold
    ? target
    : current < target
      ? Math.min(target, f(current + increase))
      : target < current
        ? Math.max(f(current - decrease), target)
        : target;
}

// FastSeparableGaussianBlur.ps samples +offset, center, -offset. Preserve its
// negative*W + (center*Z + positive*W) association without a fused operation.
export function directNavmeshBlurSample(positive, center, negative, value) {
  positive = scalar(positive);
  center = scalar(center);
  negative = scalar(negative);
  const [, , centerWeight, sideWeight] = parameters(value);
  return scalar(
    f(
      f(negative * sideWeight) +
        f(f(center * centerWeight) + f(positive * sideWeight)),
    ),
  );
}
