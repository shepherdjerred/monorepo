/** Poll immediately, then back off while retaining the caller's full deadline. */
export function releasePollDelayMs(
  elapsedMs: number,
  remainingMs: number,
  overrideMs?: number,
): number {
  const interval =
    overrideMs ??
    (elapsedMs < 10_000 ? 1000 : elapsedMs < 30_000 ? 2000 : 5000);
  return Math.max(0, Math.min(interval, remainingMs));
}

/**
 * Reconcile children in stable wave order, with a barrier between waves.
 * A failure stops new children; already-started children settle before the
 * original error propagates so a retry never races work abandoned by this run.
 */
export async function reconcileInWaves<T extends { readonly wave: number }>(
  targets: readonly T[],
  reconcile: (target: T) => Promise<void>,
): Promise<void> {
  const waves = new Map<number, T[]>();
  for (const target of targets) {
    const wave = waves.get(target.wave) ?? [];
    wave.push(target);
    waves.set(target.wave, wave);
  }
  for (const [, targetsInWave] of [...waves].sort(
    ([left], [right]) => left - right,
  )) {
    let next = 0;
    const failures: unknown[] = [];
    async function worker(): Promise<void> {
      while (failures.length === 0) {
        const target = targetsInWave[next++];
        if (target === undefined) return;
        try {
          await reconcile(target);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(3, targetsInWave.length) }, worker),
    );
    if (failures.length > 0) throw failures[0];
  }
}
