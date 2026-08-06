---
id: reference-completed-2026-05-10-talos-k8s-connectivity
type: reference
status: complete
board: false
---

# Talos/Kubernetes Connectivity Investigation

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
