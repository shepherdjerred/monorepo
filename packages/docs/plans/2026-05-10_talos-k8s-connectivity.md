# Talos/Kubernetes Connectivity Investigation

## Status

Complete

## Intent

Diagnose why local Talos and Kubernetes access is failing, using existing cluster docs, recall, and read-only CLI checks before making any changes.

## Scope

- Inspect local Talos/kubectl context and endpoint configuration.
- Check whether the intended network path is available from this machine.
- Identify the root cause and concrete remediation steps.

## Verification

- `talosctl` read-only status/config commands
- `kubectl` read-only status/config commands
- Network/DNS reachability probes for configured endpoints

## Session Log — 2026-05-10

### Done

- Confirmed Talos config points at `torvalds.tailnet-1a49.ts.net`, resolving through MagicDNS to the expected tailnet address.
- Verified Talos API port `50000` was reachable while Kubernetes API port `6443` was temporarily refusing connections.
- Confirmed Kubernetes API recovered and `kubectl get nodes -o wide` reported `torvalds` as `Ready`.
- Identified the outage as a short control-plane/API-server restart window rather than a Tailscale, DNS, or Talos endpoint outage.

### Remaining

- None for the connectivity question.

### Caveats

- This was a point-in-time investigation. If the API-server restarts again, inspect apiserver/kubelet logs around the new timestamp before treating it as the same cause.
