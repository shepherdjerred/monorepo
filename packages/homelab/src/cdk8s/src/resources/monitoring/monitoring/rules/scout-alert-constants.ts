import {
  SCOUT_GATEWAY_TOPOLOGY,
  SCOUT_STAGES,
  scoutGatewayOwnerRole,
  type ScoutGatewayTopology,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";

export const SCOUT_TRPC_NON_FAULT_CODES = [
  "OK",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
];

/**
 * Which runtime role holds the Discord gateway, per stage.
 *
 * `discord_connection_status` is a plain gauge, so prom-client exports it as 0
 * from every pod that never touches a shard — and after the runtime split most
 * pods never do. A gateway-less pod reporting 0 is telling the truth: it is not
 * disconnected, it never connects by design. An unscoped aggregate over that
 * reads a correct deployment as an outage, so any rule on this gauge has to say
 * which pods it means.
 *
 * It is per stage because the owner is a property of the DEPLOYED topology, not
 * of the capability table, and the two are not the same thing at every moment.
 * A role can be split-capable and still have no pod: every role in the
 * capability table has existed since the runtime-role work, but only the ones
 * with a rendered Deployment are running anywhere.
 *
 * This table describes the intended owner after each stage syncs. Beta runs
 * `gateway` in this revision, while prod stays `combined`. Root sync updates
 * Prometheus before Scout, so the alert accepts both possible owners while a
 * gateway is rendered, including its retirement. Once that gateway is absent,
 * only the combined series can keep the alert clear.
 *
 * Pointing a stage at a role it does not run would not degrade gracefully — the
 * series simply would not exist, the `absent()` guard would fire, and that
 * stage would page continuously while perfectly healthy. An alert that is right
 * about the future and wrong about the present is wrong.
 *
 * ## Why this is derived rather than typed out
 *
 * That failure mode is not hypothetical, and until this became a derivation it
 * was one edit away in the rollback direction. `SCOUT_GATEWAY_TOPOLOGY` and
 * this table were two hand-maintained lists describing the same fact, and
 * nothing coupled them. Retiring beta's gateway while this still said `gateway`
 * would delete the only pod exporting
 * `discord_connection_status{role="gateway"}`, so `absent()` would fire and
 * beta would page critical continuously — during a rollback, and without
 * clearing, because beta's combined series is not in its own selector.
 *
 * Deriving it from the topology keeps the pod, alert and dashboard target
 * aligned after reconciliation. A `retiring` stage answers `combined` because
 * the backend has taken the shard back by the time its gateway scales away.
 *
 * `activity-worker` is deliberately absent, and not only because it owns no
 * gateway — its Deployment is deferred out of this wave entirely.
 */
export const SCOUT_GATEWAY_OWNER_BY_STAGE = SCOUT_STAGES.map((environment) => ({
  environment,
  role: scoutGatewayOwnerRole(environment),
  topology: SCOUT_GATEWAY_TOPOLOGY[environment],
}));

export function scoutGatewayAlertRoleMatcher(
  topology: ScoutGatewayTopology,
): string {
  return topology === "absent" ? 'role="combined"' : 'role=~"combined|gateway"';
}

/**
 * The same answer as a role set, for callers that cannot phrase a per-stage
 * disjunction.
 *
 * A Grafana panel is filtered by template variables rather than by a fixed
 * environment, so it cannot spell one term per stage without discarding the
 * operator's environment selection. It can still refuse to look at pods that do
 * not own a gateway, which is the part that matters: with `$role` set to All, a
 * panel reading `discord_connection_status` unscoped takes the application
 * pod's truthful 0 and shows a disconnected bot while the gateway is connected.
 *
 * Derived from the table rather than typed out, so the split PR's one-line flip
 * moves the dashboards with the alert instead of leaving them a revision
 * behind. It is a union across stages, which is exact while no stage runs two
 * gateway-owning roles at once — true today, true after the flip, and untrue
 * only during the rollout itself.
 */
export const SCOUT_GATEWAY_OWNER_ROLES = [
  ...new Set(SCOUT_GATEWAY_OWNER_BY_STAGE.map((stage) => stage.role)),
];
