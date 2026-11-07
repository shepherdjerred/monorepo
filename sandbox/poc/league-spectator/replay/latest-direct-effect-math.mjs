const f = Math.fround;

// Original particle transforms retain the supplied system basis at birth.
// Matrices and vectors use column-major storage, with binary32 intermediates.
export function directParticleWorldBasis(basis, system) {
  return basis.map((axis) => directParticleWorldVector(axis, system));
}

export function directParticleWorldVector(axis, system) {
  return axis.map((_, lane) =>
    f(
      f(f(system[lane] * axis[0]) + f(system[3 + lane] * axis[1])) +
        f(system[6 + lane] * axis[2]),
    ),
  );
}

// The original constant-angular branch derives rotation from particle age and
// the birth rotation. It does not accumulate display-frame deltas or RNG draws.
export function directParticleRotation(rotation, velocity, age) {
  return velocity
    ? rotation.map((value, lane) => f(value + f(velocity[lane] * age)))
    : rotation;
}

// Native point/quad observations use Y * X * Z Euler composition. Arguments and
// intermediate arithmetic are binary32; JS libm rounded to float32 remains the
// same explicit external-math convention used by the existing component probes.
export function directParticleBasis(degrees) {
  const rad = f(Math.PI / 180);
  const [x, y, z] = degrees.map((v) => f(v * rad));
  const sx = f(Math.sin(x)),
    cx = f(Math.cos(x));
  const sy = f(Math.sin(y)),
    cy = f(Math.cos(y));
  const sz = f(Math.sin(z)),
    cz = f(Math.cos(z));
  return [
    [
      f(f(cy * cz) + f(f(sy * sx) * sz)),
      f(cx * sz),
      f(f(f(cy * sx) * sz) - f(sy * cz)),
    ],
    [
      f(f(f(sy * sx) * cz) - f(cy * sz)),
      f(cx * cz),
      f(f(sy * sz) + f(f(cy * sx) * cz)),
    ],
    [f(sy * cx), f(-sx), f(cy * cx)],
  ];
}

export function directPackedColor(rgba) {
  // Original shared 0x148f090 truncates float32 products and keeps their low
  // bytes. HDR/negative authored channels wrap rather than saturating.
  const bytes = rgba.map((v) => Math.trunc(f(v * 255)) & 255);
  return [bytes[2], bytes[1], bytes[0], bytes[3]];
}
