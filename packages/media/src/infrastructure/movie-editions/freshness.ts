import { MovieChoiceProtection } from "./errors.ts";

/** Process-local only: never add to a persisted audit, birth proof or response. */
export type MovieChoiceFreshness = {
  readonly expiresAtMs: number;
  assertActive: () => void;
};

export function movieChoiceFreshness(
  verifiedAt: Date,
  observed: { wall: number; monotonic: number },
): MovieChoiceFreshness {
  const verified = verifiedAt.getTime();
  const deadline = Math.floor(verified + 300_000);
  const monotonicDeadline = observed.monotonic + deadline - observed.wall;
  if (
    !Number.isFinite(verified) ||
    !Number.isSafeInteger(deadline) ||
    !Number.isFinite(monotonicDeadline)
  )
    throw new TypeError("Movie choice mapping verification time is invalid");
  const assertActive = () => {
    const now = Date.now();
    if (
      now < verified ||
      now >= deadline ||
      performance.now() >= monotonicDeadline
    )
      throw new MovieChoiceProtection("movie_edition_choice_changed");
  };
  assertActive();
  return { expiresAtMs: deadline, assertActive };
}
