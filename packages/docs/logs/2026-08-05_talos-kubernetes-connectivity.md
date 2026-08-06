---
id: log-2026-08-05-talos-kubernetes-connectivity
type: log
status: complete
board: false
---

# Talos and Kubernetes connectivity investigation

## Symptom

The local Talos and Kubernetes clients could not connect to the `torvalds` cluster.

## Evidence

- Both clients target `torvalds.tailnet-1a49.ts.net`.
- `dig`, `curl`, `talosctl`, and `kubectl` all failed because the hostname had no DNS answer.
- The bundled Tailscale CLI reported `Tailscale is stopped`.
- The Tailscale Network Extension was installed and the macOS VPN service appeared connected, but no Tailscale DNS resolver was configured.
- The Talos certificate is not expired (it expires in 2027); authentication was never reached because DNS failed first.

## Root cause

The Tailscale client is stopped, so MagicDNS cannot resolve the cluster hostname and the Tailscale route to the cluster is unavailable. This is a local connectivity problem, not a Talos certificate or Kubernetes RBAC problem.

## Recovery

Start/connect Tailscale on the Mac, then verify the hostname resolves before retrying:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
dig +short torvalds.tailnet-1a49.ts.net
talosctl version --nodes torvalds.tailnet-1a49.ts.net
kubectl get nodes
```

## Session Log — 2026-08-05

### Done

- Inspected the active Talos and Kubernetes contexts and API endpoint.
- Tested DNS, TCP, HTTPS, Talos API, and Kubernetes API connectivity.
- Confirmed the bundled Tailscale client reports a stopped state.
- Recorded the root cause and recovery commands.
- Confirmed Tailscale is connected again, MagicDNS resolves `torvalds`, and both Kubernetes nodes are `Ready`.

### Remaining

- None.

### Caveats

- The original outage was local to Tailscale/DNS; no cluster-side remediation was needed.
