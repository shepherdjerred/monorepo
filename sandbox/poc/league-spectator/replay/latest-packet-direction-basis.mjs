import { createLatestRootAttachmentProviderKernels } from "./latest-root-attachment-provider.mjs";

const f = Math.fround;
const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const PACKET_DIRECTION_BASIS_BLOCKS = Object.freeze(
  [
    [
      0x2098b0,
      336,
      "df637745d75522c451ac47298bc74eb1c04a50e57db80ac99ed86ee0f454dc10",
    ],
    [
      0x209a20,
      122,
      "45bbfd41ec1645d71ffe76aaee36e5cdf5bfac7bf5bacc24fbbc2cc4ec02ce64",
    ],
    [
      0x209e40,
      311,
      "2a6bbac48b8583095ac416580fb8ac92078afa3c8ec2c2db0dfa61508897e105",
    ],
    [
      0x148a750,
      94,
      "ec6cdb3b6d141840faf7b9531f3cde0b4bfa2606e538fd4f5b1905bf383ba095",
    ],
    [
      0x1755d40,
      49,
      "1ac679a6a3f6f0eb025db51c656a3044b14100f945a7840fea9ac22f50d789a6",
    ],
    [
      0x83edfa,
      154,
      "f3a6ce2a572d2381ad9f3c15379ed7ce0e0e519602f90fbb38aa80fc7e6f75e5",
    ],
  ].map(Object.freeze),
);

// Original 148a750 preserves vectors whose squared magnitude is <=1e-9.
function normalize(v) {
  const lengthSquared = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (lengthSquared <= f(1e-9)) return v;
  const inverse = f(1 / f(Math.sqrt(lengthSquared)));
  return v.map((n) => f(n * inverse));
}

export function createLatestPacketDirectionBasis(profile) {
  createLatestRootAttachmentProviderKernels(profile);
  return Object.freeze({
    // Only the observed horizontal branch is admitted. This authored packet
    // vector is independent of the source provider's entity-facing direction.
    horizontal(direction) {
      if (
        !Array.isArray(direction) ||
        direction.length !== 3 ||
        direction.some((n) => !Number.isFinite(n) || !Number.isFinite(f(n)))
      )
        throw Error("Finite float32 packet direction required");
      const [x, y, z] = direction.map(f);
      if (y !== 0)
        throw Error("Nonhorizontal packet direction is not admitted");
      // Original 209e60 compares horizontal components with the zero vector.
      if (Math.abs(x) <= f(1e-5) && Math.abs(z) <= f(1e-5)) return identity();
      const forward = normalize([x, 0, z]);
      // Preserve the original SSE multiply/add order and signed zero.
      const right = normalize([
        f(f(y * -0) + z),
        f(f(x * 0) + f(z * -0)),
        f(f(y * 0) + -x),
      ]);
      return [...right, 0, 1, 0, ...forward];
    },
  });
}
