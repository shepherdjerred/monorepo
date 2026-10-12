/**
 * Wait budget for one child sync in `release-root`. Children whose Argo
 * operation legitimately outlasts the pipeline `--timeout` carry a floor in
 * `floors` (Temporal's schema migration and Scout's cold report-lake startup).
 * Waiting the default budget declares failure while startup is still within
 * the workload's own deadline. A floor is a minimum, never a ceiling: a higher
 * global default still wins, so raising `--timeout` keeps working and each
 * entry only documents what its child cannot complete without.
 *
 * This module stays dependency-free on purpose: the linted scripts tree
 * cannot relatively import the shared budgets module across the package
 * boundary, so `argocd.ts` (which already does) builds the floors map from
 * the workload budgets and passes it in.
 */
export function childSyncTimeoutSeconds(
  appName: string,
  defaultTimeoutSeconds: number,
  floors: ReadonlyMap<string, number>,
): number {
  const floor = floors.get(appName) ?? defaultTimeoutSeconds;
  return Math.max(defaultTimeoutSeconds, floor);
}
