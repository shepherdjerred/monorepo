/**
 * Deterministic diff-slicing for randomized specialist passes.
 *
 * # Why
 *
 * The plan calls for `N=3` randomized passes per specialist (Cursor BugBot
 * v11 / Refute-or-Promote). Permuting the order in which file diffs are
 * presented to the model forces it to reconsider each file in a fresh
 * position — findings that survive permutation are robust, ones that don't
 * are dropped by `consensusVote` as noise.
 *
 * # Determinism contract
 *
 * Same `(specialistId, passId)` → same output. Different `passId` → different
 * order. Same `specialistId` and `passId=0` → identity (no permutation):
 * this preserves the single-agent Phase 2 baseline behavior and lets the
 * replay CLI reproduce a pass byte-for-byte.
 *
 * # Algorithm
 *
 *   FNV-1a 32-bit hash of `${specialistId}:${passId}` → 32-bit seed
 *   mulberry32 PRNG seeded with that integer
 *   Fisher-Yates shuffle of the input array
 *
 * mulberry32 is cheap, deterministic, and well-distributed for this use; we
 * don't need cryptographic randomness.
 */

/**
 * One file's slice of a PR diff. Structurally compatible with
 * `PrFileDiff` from `#shared/pr-review/context.ts` but declared here as a
 * minimal local shape so this module has no dependency on the broader
 * review-context types.
 */
export type SliceableFileDiff = {
  path: string;
};

/**
 * mulberry32 PRNG — fast, deterministic, 32-bit state. Returns a function
 * that yields a float in `[0, 1)` on each call.
 *
 * Source: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * FNV-1a 32-bit hash. Used only to compress an arbitrary seed string
 * (e.g. `"correctness:2"`) into a 32-bit integer for mulberry32. No
 * cryptographic claims.
 */
function fnv1a32(input: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i++) {
    // codePointAt + non-null-assert: the index is within `input.length`, so
    // the call is total. ASCII-only seeds are typical (specialist ids,
    // numeric pass) and BMP-only seeds are guaranteed-safe here too.
    hash ^= input.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return hash >>> 0;
}

/**
 * Returns a permutation of `files` derived deterministically from
 * `(specialistId, passId)`.
 *
 * - `passId === 0` → returns a copy in original order (identity). This
 *   preserves the baseline behavior the Phase 2 single-call path implements.
 * - Otherwise the array is shuffled with a seeded Fisher-Yates pass.
 *
 * Pure: does not mutate the input array.
 */
export function permuteFiles<T extends SliceableFileDiff>(input: {
  files: readonly T[];
  specialistId: string;
  passId: number;
}): T[] {
  const { files, specialistId, passId } = input;
  if (passId === 0) {
    return [...files];
  }
  const seed = fnv1a32(`${specialistId}:${String(passId)}`);
  const rng = mulberry32(seed);
  const arr = [...files];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    const other = arr[j];
    if (tmp === undefined || other === undefined) {
      // Unreachable: `i` and `j` are both in-range integers and the array
      // was just cloned from a non-sparse source. Belt-and-suspenders for
      // `noUncheckedIndexedAccess`.
      throw new Error("permuteFiles: unreachable index");
    }
    arr[i] = other;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Number of randomized passes each specialist runs. Pinned here so the
 * consensus voting math (≥2/3 within-specialist agreement) stays in sync
 * with the specialist activity's loop bound. Changing this requires
 * updating the consensus threshold.
 */
export const PASSES_PER_SPECIALIST = 3;
