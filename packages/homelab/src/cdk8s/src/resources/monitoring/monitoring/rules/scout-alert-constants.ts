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
 * A role can be split-capable and still have no pod: `gateway` exists in the
 * capability table today, but the Deployment that would run it ships in the
 * runtime-split PR, which is merge-held for an operator gate.
 *
 * So this table describes what is actually running, and right now that is
 * `combined` in both stages. Pointing beta at `gateway` ahead of the split
 * would not degrade gracefully — the series simply would not exist, the
 * `absent()` guard would fire, and beta would page continuously while perfectly
 * healthy. An alert that is right about the future and wrong about the present
 * is wrong.
 *
 * The split PR flips beta to `gateway` in its own diff, so the alert and the
 * topology change at the same ArgoCD revision and neither is briefly true
 * alone. That is also why this stays a table rather than being folded into a
 * single selector: the flip has to be one obvious line.
 *
 * `activity-worker` is deliberately absent, and not only because it owns no
 * gateway — its Deployment is deferred out of this wave entirely.
 */
export const SCOUT_GATEWAY_OWNER_BY_STAGE = [
  { environment: "beta", role: "combined" },
  { environment: "prod", role: "combined" },
];
