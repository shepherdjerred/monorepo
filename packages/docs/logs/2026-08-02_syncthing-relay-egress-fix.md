---
id: 2026-08-02_syncthing-relay-egress-fix
type: log
status: complete
board: false
---

# Syncthing: torvalds ↔ macbook / steam deck can't connect — relay egress fix

## Symptom

The macbook's Syncthing showed `torvalds` as **Disconnected (Inactive)**, and torvalds
showed both `macbook` and `steam deck` as **Disconnected (Inactive)** — while `desktop`
stayed **Up to Date**. torvalds itself was healthy (3d17h uptime, v2.1.2, connected to
`desktop`). So this was not the transient v1→v2 migration from
`2026-08-02_syncthing-macbook-offline-diagnosis.md` — that had resolved; this is a
persistent reachability failure specific to the NAT'd peers.

## Root cause — two-sided dead end, relay fallback blocked

torvalds runs Syncthing in-cluster (`syncthing` ns) and can **only ever dial outward**:

- Only the **GUI (8384)** is exposed, via an L7 HTTP `TailscaleIngress`
  (`src/cdk8s/src/resources/syncthing.ts`). The **sync port 22000 is not exposed by any
  Service**, and the ingress NetworkPolicy (`src/cdk8s/src/cdk8s-charts/syncthing.ts`)
  blocks all inbound except the `tailscale` / `prometheus` namespaces. → torvalds accepts
  **no inbound sync connections**.
- The macbook moved to a network behind **Symmetric NAT** (see the companion diagnosis
  log). → it has **no directly-dialable address** either.

When both peers lack an inbound path, the only route is a **relay**. But torvalds' _egress_
NetworkPolicy allowed only `443/TCP` (discovery + relay-pool lookup), `22000/TCP+UDP`, and
`21027/UDP`. Public Syncthing relays (`strelaysrv`) accept the relay **data connection on
port 22067**, which was **absent from the egress allowlist**. So torvalds could enumerate
relays but never connect to one → no path to any peer it can't dial directly.

- `desktop` works: it has a directly-reachable address, so torvalds' **outbound** dial to
  `desktop:22000` succeeds.
- `macbook` / `steam deck` fail: not directly dialable, and the relay fallback is blocked.

(Discovery `3/5` / `4/5` is a red herring — just the IPv6 discovery servers failing on an
IPv4 network.)

## Options considered

1. **Expose 22000 on the tailnet** (Tailscale operator LoadBalancer). Direct/fast, but the
   proxy address can't be auto-advertised via Syncthing discovery, so it needs a **one-time
   per-client address edit** on macbook + steam deck. Rejected: per-client fiddling.
2. **Unblock relay egress (this fix).** Add `22067/TCP` to torvalds' egress netpol. torvalds
   connects to a public relay, advertises itself via global discovery, and the NAT'd peers
   reconnect **automatically** — clients keep `dynamic`, **zero client changes**. Traffic
   stays end-to-end encrypted (relays can't read it); relayed transfer is slightly slower,
   which is irrelevant for small game-save files. **Chosen.**
3. Tailscale sidecar in the Syncthing pod (zero client change + direct, but the most infra
   work). Overkill for save syncing.
4. Router port-forward of 22000 (public exposure). Rejected.

## Change

`src/cdk8s/src/cdk8s-charts/syncthing.ts` — added one port to the Syncthing-protocols
egress rule, and clarified the `443` comment (it's discovery + relay _pool lookup_, not the
data path):

```ts
{ port: IntOrString.fromNumber(443), protocol: "TCP" },    // Global discovery + relay pool lookup
{ port: IntOrString.fromNumber(22_067), protocol: "TCP" }, // Relay data connection (strelaysrv)
```

No other change: the ingress netpol, the GUI service/ingress, and the deployment are
untouched. No client-side change.

## Verification

- **Local (done):** `bun run build` (cdk8s) → `dist/syncthing.k8s.yaml` renders `22067/TCP`
  under `syncthing-egress-netpol`; `bun run typecheck` and `eslint` clean;
  `helm-template.test.ts` 10/10 pass.
- **Post-deploy (ArgoCD):** on torvalds, confirm it establishes a `relay-client` connection
  (`/rest/system/connections` shows a relay address); then confirm macbook + steam deck
  flip to **Connected** with `dynamic` addresses (no client edit). This is the acceptance
  step — it can't be verified until the change is merged and ArgoCD syncs.

## Session Log — 2026-08-02

### Done

- Root-caused the persistent torvalds↔macbook/steam-deck failure: torvalds is outbound-only
  (no inbound sync path) and its egress netpol lacked relay port 22067, so relaying — the
  only path for NAT'd peers — silently failed.
- Fix: added `22067/TCP` to the Syncthing egress NetworkPolicy
  (`src/cdk8s/src/cdk8s-charts/syncthing.ts`). Zero client-side changes.
- Worktree `homelab/syncthing-relay-egress`; PR opened as a one-layer `gh stack`.

### Remaining

- Post-merge acceptance (operator/human, after ArgoCD sync): confirm torvalds relay-connects
  and macbook + steam deck reconnect automatically.

### Caveats

- Relayed transfers route through third-party public relays (E2E-encrypted; slower than
  direct — fine for save files). If a chosen relay ever uses a non-default port, that
  specific relay would still be blocked; Syncthing picks from many 22067 relays, so this is
  not expected to matter.
- If direct/fast sync is ever wanted, the Tailscale-LB option (option 1) remains available at
  the cost of a one-time per-client address edit.
