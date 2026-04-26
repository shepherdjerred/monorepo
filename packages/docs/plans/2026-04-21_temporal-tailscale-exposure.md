# Expose Temporal gRPC over Tailscale (no port-forward)

## Status

Not Started. The Temporal runbook still uses port-forwarding, and no `TailscaleService` helper exists yet.

**Problem:** `temporal` CLI can't reach the cluster from a dev machine. The current `TailscaleIngress` for `temporal` terminates HTTPS on :443 and doesn't pass gRPC through on :7233, so connecting to `temporal.tailnet-1a49.ts.net:7233` hits a closed port. The runbook workaround (`kubectl port-forward`) works but is annoying for daily use.

**Goal:** Make `TEMPORAL_ADDRESS=temporal-server.tailnet-1a49.ts.net:7233 temporal ...` work directly from any tailnet device.

## Options

| #   | Approach                                     | Pros                                                                     | Cons                                                       |
| --- | -------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | `loadBalancerClass: tailscale` on a Service  | Cleanest; one YAML change; MagicDNS hostname; raw TCP so gRPC just works | Adds a per-service tailnet node (extra identity to manage) |
| 2   | `tailscale.com/expose` annotation on Service | Same outcome as #1                                                       | Older, less idiomatic than LB class                        |
| 3   | Tailscale sidecar in temporal-server pod     | Workload itself on tailnet (no proxy hop)                                | Extra container, auth key management, more moving parts    |

**Pick: Option 1.** Minimal change, matches how the Tailscale operator wants you to do raw-TCP exposure today.

## Implementation

### 1. Add a `TailscaleService` helper (sibling to `TailscaleIngress`)

File: `packages/homelab/src/cdk8s/src/misc/tailscale.ts`

New construct that creates a `Service` with `type: LoadBalancer`, `loadBalancerClass: "tailscale"`, and `spec.loadBalancerName` (or hostname annotation) set so MagicDNS picks up `<host>.tailnet-1a49.ts.net`.

```typescript
export class TailscaleService extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: {
      selector: Record<string, string>;
      host: string;
      port: number;
      targetPort?: number;
    },
  ) {
    super(scope, id);
    new KubeService(scope, `${id}-svc`, {
      metadata: {
        name: props.host,
        annotations: { "tailscale.com/hostname": props.host },
      },
      spec: {
        type: "LoadBalancer",
        loadBalancerClass: "tailscale",
        selector: props.selector,
        ports: [
          { port: props.port, targetPort: props.targetPort ?? props.port },
        ],
      },
    });
  }
}
```

### 2. Wire it into the temporal server chart

File: `packages/homelab/src/cdk8s/src/resources/temporal/server.ts`

- **Remove** the existing `TailscaleIngress` at line 184 (HTTPS ingress isn't useful for the gRPC port).
- **Add** a `TailscaleService` selecting `app: temporal-server` on port 7233 with host `temporal-server` (or keep `temporal` — pick one that doesn't collide with the UI ingress).

Naming note: the UI uses `temporal-ui` on its TailscaleIngress, so `temporal-server` is a clean name for the gRPC endpoint and keeps `temporal` → UI via `temporal.sjer.red` semantics intact.

### 3. Verify NetworkPolicy still allows ingress

File: `packages/homelab/src/cdk8s/src/cdk8s-charts/temporal.ts`

The existing `temporal-server-netpol` restricts inbound traffic to specific pod selectors (workers, UI, etc.). The Tailscale operator proxy runs as a pod in `tailscale` namespace — confirm its identity is allowed to reach `app: temporal-server` on 7233, or widen the policy to allow the Tailscale proxy namespace.

### 4. Update runbook

File: `packages/docs/guides/2026-04-04_homelab-audit-runbook.md`

Replace the port-forward block (lines ~243–244) with:

```bash
export TEMPORAL_ADDRESS=temporal-server.tailnet-1a49.ts.net:7233
temporal operator cluster health
```

## Rollout

1. Implement `TailscaleService` construct + tests.
2. Update `temporal/server.ts` to use it.
3. `bun run typecheck && bun run test` in `packages/homelab`.
4. Merge → ArgoCD syncs the chart → Tailscale operator provisions the proxy node.
5. Verify `tailscale status` shows the new node, then run `temporal operator cluster health`.
6. Update runbook.

## Risks & open questions

- **NetworkPolicy** may silently block the operator proxy — validate before removing the port-forward docs.
- **Auth**: current gRPC is unauthenticated and now reachable from any tailnet device. That's consistent with the existing tailnet trust model (UI is also tailnet-exposed) but worth a conscious ack.
- **Metrics port (9090)**: not exposed over tailnet today. Out of scope for this plan; add a second `TailscaleService` later if needed.
- Any other consumer currently pointing at `temporal.tailnet-1a49.ts.net:7233`? Grep confirms only the runbook references this address, so no breakage expected.
