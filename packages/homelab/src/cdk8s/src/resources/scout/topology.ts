import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

/**
 * Whether a stage runs the Discord shard in its own pod, and — the state that
 * exists only because ArgoCD does not prune here — whether it is on its way
 * back from having done so.
 *
 * `split`    the gateway role runs in scout-gateway; the backend is
 *            `application` and holds no shard.
 * `retiring` the backend is back to `combined` and owns the shard again, and
 *            the gateway Deployment is still rendered but scaled to zero.
 * `absent`   nothing gateway-shaped is rendered at all.
 *
 * ## Why `retiring` has to exist
 *
 * scout-beta's Application enables automated sync and does NOT enable pruning
 * (`resources/argo-applications/apps/scout-beta.ts`). A resource that stops
 * being rendered therefore stops being managed and keeps running. For most
 * resources that is untidy; for this one it is an outage. The gateway pod holds
 * the Discord token, so a rollback that merely stopped rendering it would leave
 * it logged in while the rolled-back backend returned to `combined` and opened
 * a second session on the same token. Discord resolves that by dropping one,
 * which reads as a flapping bot.
 *
 * So retirement is a rendered state rather than an absence: the Deployment
 * stays in the manifest at zero replicas, automated sync scales it down on its
 * own, and the token is released without an operator scaling anything by hand.
 * The resource is deleted outright in a later change, once the rollback has
 * been proven once — which is what `absent` is for.
 *
 * This is the same answer the chart already gives the same problem for the
 * workflow-worker candidate Deployment, which is kept rendered "so promotion
 * does not leave unmanaged candidate resources behind when pruning is
 * disabled" (`cdk8s-charts/scout.ts`). Keep-rendering is the established idiom
 * here, not a new one.
 *
 * ## Why this is a table and not a predicate
 *
 * Topology must never appear as a side effect of a version bump: a stage runs
 * the split because someone wrote it here. A `Record<Stage, …>` rather than a
 * list so a new stage is a compile error instead of silently defaulting to
 * whatever the absent case happens to be.
 */
export type ScoutGatewayTopology = "split" | "retiring" | "absent";

/**
 * Every stage, in the order the derived monitoring table renders them.
 *
 * Spelled out rather than taken from `Object.keys` so the alert expression's
 * term order is a reviewable property of this file instead of an accident of
 * object literal ordering.
 */
export const SCOUT_STAGES = [
  "beta",
  "prod",
] as const satisfies readonly Stage[];

export const SCOUT_GATEWAY_TOPOLOGY: Readonly<
  Record<Stage, ScoutGatewayTopology>
> = {
  beta: "split",
  // Prod has never run the split and so has nothing to retire. It is `absent`
  // rather than `retiring` on purpose: rendering a zero-replica gateway here
  // would add a Deployment, Service, ServiceMonitor and NetworkPolicy to
  // production that have never existed there.
  prod: "absent",
};

/**
 * The topology runs the `gateway` role in its own pod.
 *
 * False while retiring: the shard has already gone back to the combined pod,
 * which is why a retiring stage's backend carries voice and its UDP egress
 * again.
 */
export function gatewayTopologyRunsRole(
  topology: ScoutGatewayTopology,
): boolean {
  return topology === "split";
}

/**
 * The topologies that render the gateway's resources at all.
 *
 * Both non-`absent` states do: the Deployment (at zero replicas while
 * retiring), Service, ServiceMonitor and NetworkPolicy all stay rendered
 * through retirement so the stage stays fully managed rather than
 * half-orphaned, and they select nothing once the pod is gone.
 *
 * Spelled as a type rather than a predicate function because callers need the
 * NARROWING, and this repository bans hand-written type guards in favour of
 * parsing. A plain `topology !== "absent"` comparison at the call site narrows
 * natively and needs no guard.
 */
export type RenderedGatewayTopology = Exclude<ScoutGatewayTopology, "absent">;

/**
 * Which runtime role actually holds this stage's Discord gateway.
 *
 * The value is the `SCOUT_RUNTIME_ROLE` string from the backend's capability
 * table, so a metrics selector can name the role rather than re-deriving it
 * from a workload name. A retiring stage answers `combined`, because the
 * backend has already taken the shard back by the time its gateway scales away.
 */
export function scoutGatewayOwnerRole(stage: Stage): "gateway" | "combined" {
  return gatewayTopologyRunsRole(SCOUT_GATEWAY_TOPOLOGY[stage])
    ? "gateway"
    : "combined";
}
