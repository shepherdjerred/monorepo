/**
 * Wait budget for one child sync in `release-root`. Children whose Argo
 * operation legitimately outlasts the pipeline `--timeout` carry a floor in
 * `floors` (currently only temporal: its operation runs the
 * schema-migration Sync hook, so waiting the default budget declares failure
 * while the migration is still running and the next build replaces the
 * in-flight hook mid-DDL). A floor is a minimum, never a ceiling: a higher
 * global default still wins, so raising `--timeout` keeps working and each
 * entry only documents what its child cannot complete without.
 *
 * This module stays dependency-free on purpose: the linted scripts tree
 * cannot relatively import the shared budgets module across the package
 * boundary, so `argocd.ts` (which already does) builds the floors map from
 * `TEMPORAL_CHILD_SYNC_TIMEOUT_SECONDS` and passes it in.
 */
export function childSyncTimeoutSeconds(
  appName: string,
  defaultTimeoutSeconds: number,
  floors: ReadonlyMap<string, number>,
): number {
  const floor = floors.get(appName) ?? defaultTimeoutSeconds;
  return Math.max(defaultTimeoutSeconds, floor);
}
