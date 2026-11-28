import type { QueryKey } from "@tanstack/react-query";
import type { ChangeDomain, ChangeEvent } from "#shared/hub/change-contract.ts";

const RELEASE: QueryKey[] = [
  ["commits"],
  ["deployments"],
  ["approvals"],
  ["environment"],
  ["service"],
  ["trace"],
  ["overview"],
  ["integration", "runtime"],
];
const CATALOG: QueryKey[] = [
  ["commits"],
  ["service"],
  ["trace"],
  ["builds"],
  ["environment"],
  ["overview"],
  ["versions"],
];
const INTENT: QueryKey[] = [
  ["deployment"],
  ["environment"],
  ["overview"],
  ["recovery-intent"],
];

const BY_DOMAIN: Record<ChangeDomain, (change: ChangeEvent) => QueryKey[]> = {
  // Every cached deployment detail, not only the changed one: a detail
  // reads what newer requests for its environment are doing (`newerRequest`,
  // `acceptedRelease`), so a settled or canceled request refreshes the older
  // deployment's page too. The change names no environment to narrow it by;
  // only the open detail refetches, the rest refetch when next opened.
  deployment: () => [["deployment"], ["recovery-intent"], ...RELEASE],
  build: () => CATALOG,
  versionSet: () => CATALOG,
  artifact: () => CATALOG,
  environment: () => [["commits"], ["environment"], ["service"], ["overview"]],
  pipeline: () => [["environment"], ["service"], ["overview"]],
  worker: () => [["workers"], ...INTENT],
  platform: () => [...INTENT, ["approvals"], ["commits"], ["service"]],
  content: () => INTENT,
  minecraft: () => INTENT,
  forum: () => INTENT,
  control_plane: () => INTENT,
  trmnl: () => INTENT,
  snapshot: () => [],
  catalog: () => [["environment"], ["service"], ["overview"]],
  monitor: (change) => [["deployment", change.entityId], ...INTENT],
};

/**
 * The overview grid's key. It sits under `["hub"]`, the prefix every change
 * invalidates, so the grid refreshes whenever the pipelines read does: any
 * change can move a status, a count or an attention item on either.
 */
export const GRID_KEY = ["hub", "grid"] as const;

/** Query-key prefixes a committed change can make stale. */
export function keysForChange(change: ChangeEvent): QueryKey[] {
  return [["hub"], ["activity"], ...BY_DOMAIN[change.domain](change)];
}
