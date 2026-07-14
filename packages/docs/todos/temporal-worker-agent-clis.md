---
id: temporal-worker-agent-clis
status: active
origin: packages/docs/plans/2026-07-13_ci-parity-implementation.md
---

# temporal-worker image: agent CLI layers not yet restored

The rebuilt packages/temporal/Dockerfile covers worker boot + Temporal
connectivity only. The old Dagger-built worker image additionally baked in
gh, claude, codex, kubectl, github-mcp-server, talosctl, tofu, argocd,
velero, bk, temporal, and cog for the PR-agent / homelab-audit /
readme-refresh scheduled workflows. Those workflows will fail at exec time
on the new image until the CLI layers are re-added (see the note at the top
of packages/temporal/Dockerfile). Recover the exact tool list + versions
from `.dagger/src/image.ts` at `4f11973dc^` (buildTemporalWorkerImage).
