import type { QueryKey } from "@tanstack/react-query";
import type { ChangeDomain, ChangeEvent } from "#shared/hub/change-contract.ts";

const RELEASE: QueryKey[] = [
  ["deployments"],
  ["approvals"],
  ["environment"],
  ["service"],
  ["trace"],
  ["overview"],
  ["integration", "runtime"],
];
const CATALOG: QueryKey[] = [
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
  deployment: (change) => [
    ["deployment", change.entityId],
    ["recovery-intent"],
    ...RELEASE,
  ],
  build: () => CATALOG,
  versionSet: () => CATALOG,
  artifact: () => CATALOG,
  environment: () => [["environment"], ["service"], ["overview"]],
  pipeline: () => [["environment"], ["service"], ["overview"]],
  worker: () => [["workers"], ...INTENT],
  platform: () => [...INTENT, ["service"]],
  content: () => INTENT,
  minecraft: () => INTENT,
  forum: () => INTENT,
  control_plane: () => INTENT,
  trmnl: () => INTENT,
  snapshot: () => [],
  catalog: () => [["environment"], ["service"], ["overview"]],
  monitor: (change) => [["deployment", change.entityId], ...INTENT],
};

/** Query-key prefixes a committed change can make stale. */
export function keysForChange(change: ChangeEvent): QueryKey[] {
  return [["hub"], ["activity"], ...BY_DOMAIN[change.domain](change)];
}
