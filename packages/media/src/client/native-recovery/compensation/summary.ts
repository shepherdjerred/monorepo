type TransitionNamed = { transitionId: string };

/**
 * What a compensation scope covers, counted for the confirmation. An upgrade
 * is one publication transition. `NativeCompensationScopeSchema` rejects a
 * scope that names different transitions in these three places, so the count
 * is always one; it is counted from the ids so the page states what the scope
 * says. The entries are the files inside the upgrade, not upgrades of their
 * own.
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
