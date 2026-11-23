type TransitionNamed = { transitionId: string };

/**
 * What a compensation scope covers, counted for the confirmation. An upgrade
 * is one publication transition, which the scope names in three places that
 * agree; the entries are the files inside it, not upgrades of their own.
 */
export function restorationSummary(scope: {
  transition: TransitionNamed;
  intent: TransitionNamed;
  interruptedWork: TransitionNamed;
  entries: readonly unknown[];
}): { upgrades: number; files: number } {
  return {
    upgrades: new Set([
      scope.transition.transitionId,
      scope.intent.transitionId,
      scope.interruptedWork.transitionId,
    ]).size,
    files: scope.entries.length,
  };
}
