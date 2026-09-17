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
 * It is per stage because the owner genuinely differs. Beta runs an
 * `application` pod and a `gateway` pod, so the gateway role holds the shard.
 * Prod is still `combined`, where the same process holds everything. A single
 * union selector would happen to work today, but it would also keep working
 * silently if a stage grew a pod whose role is on the list and should not be
 * holding the shard — this table makes each stage's answer something a reader
 * can check against the deployment.
 *
 * `activity-worker` is deliberately absent: it owns no gateway, and its
 * Deployment is deferred out of this wave entirely.
 *
 * When prod splits, edit this table. It is the only place the mapping lives.
 */
export const SCOUT_GATEWAY_OWNER_BY_STAGE = [
  { environment: "beta", role: "gateway" },
  { environment: "prod", role: "combined" },
];
