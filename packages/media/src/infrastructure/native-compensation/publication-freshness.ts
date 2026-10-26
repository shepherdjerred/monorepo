import { NativeCompensationProtection } from "./protection.ts";

/** Process-local expiry fence, never part of a persisted command or identity hash. */
export function publicationFreshness(
  observed: { wall: number; monotonic: number },
  expiresAt: number,
): { readonly expiresAtMs: number; assertActive: () => void } {
  if (!Number.isFinite(expiresAt))
    throw new TypeError("Invalid compensation publication authority deadline");
  const monotonicDeadline = observed.monotonic + expiresAt - observed.wall;
  return {
    expiresAtMs: Math.floor(expiresAt),
    assertActive() {
      if (Date.now() >= expiresAt || performance.now() >= monotonicDeadline)
        throw new NativeCompensationProtection(
          "compensation_publication_authority_expired",
        );
    },
  };
}
