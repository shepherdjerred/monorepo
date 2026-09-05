---
name: homelab-development
description: Design or change repo-owned homelab infrastructure, Kubernetes resources, Helm values, services, versions, secrets, DNS, or OpenTofu. Use for code changes under packages/homelab and hosted workload deployment design.
---

# Homelab development

The homelab hosts every first-party site, API, bot, worker, and supporting
service. `packages/homelab` is the declarative source of truth; Buildkite builds
artifacts and ArgoCD reconciles Kubernetes.

Read `packages/homelab/AGENTS.md` and the closest wiki explanation or how-to
before editing. Preserve these boundaries:

- Workloads use per-namespace CDK8s charts and the existing service constructs.
- Reuse shared helpers for containers, ingress, storage, and LinuxServer images.
- Internal-only ingress uses Tailscale. Public exposure uses the existing
  Cloudflare/Tailscale patterns; do not invent a parallel edge path.
- Image and chart versions come from the language-neutral version catalog.
  Regenerate committed Helm types whenever a chart input changes.
- Recurring work is a Temporal Schedule, never a Kubernetes CronJob.
- Secrets come from 1Password through declared grants. No optional secret refs,
  literals, token files, or ambient credentials in Buildkite jobs.
- OpenTofu owns external control-plane resources and state. Do not reproduce a
  Tofu-owned setting in an application dashboard.

For a new service, identify its namespace, chart, image ownership, resources,
health probes, ingress, secrets, persistence, observability, backup class, and
ArgoCD parent before coding. Match neighboring resources instead of starting a
new abstraction without repeated need.

Run focused checks from the homelab package. Typical coverage includes:

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/homelab
bun run --cwd packages/homelab/src/cdk8s check:1password
bun run --cwd packages/homelab lint:tofu
```

Use the exact package scripts present in `package.json`; some validation needs
network schemas or live credentials and must be reported separately.
