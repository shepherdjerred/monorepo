# Infrastructure Security Audit

## Status

In Progress

## Objective

Assess the security posture of the `torvalds` homelab across the declared GitOps configuration and
the live environment. Produce a prioritized, evidence-backed remediation backlog without mutating
the cluster, tailnet, Cloudflare account, workloads, secrets, or repositories during discovery.

## Scope and Safety Boundary

- Repository configuration under `packages/homelab`, including CDK8s, Helm, ArgoCD, OpenTofu,
  Talos patches, versions, storage, backups, and secret references.
- Live Kubernetes, Talos, ArgoCD, Tailscale, and Cloudflare state when locally configured
  credentials permit read-only access.
- Kubernetes workloads, namespaces, RBAC, network paths, admission controls, storage, backups,
  observability, and software supply-chain controls.
- Public exposure through Cloudflare DNS, tunnels, Access, R2, Tailscale ingress, Funnel,
  LoadBalancer, NodePort, host networking, and host ports.
- Secret metadata and references may be inspected; secret values, credentials, tokens, private
  keys, and raw Kubernetes Secret payloads will not be collected or written to the report.
- No `apply`, `sync`, `patch`, `edit`, `delete`, `rollout`, `restart`, `reboot`, policy update,
  key rotation, or other mutating operation is authorized by this audit plan.

## Research Plan

### 1. External Attack Surface and Trust Boundaries

Inventory every intended and accidental ingress path, DNS record, tunnel, Funnel endpoint,
service type, host port, and externally reachable administrative surface. Reconcile repository
intent with live listeners and routing.

Sources: Cloudflare and Tailscale live read APIs/CLIs, Kubernetes Services and Ingresses,
OpenTofu/CDK8s definitions, official Cloudflare and Tailscale security documentation.

### 2. Talos and Kubernetes Control-Plane Hardening

Assess running versions, patch currency, endpoint exposure, certificate health, API server and
etcd settings, audit logging, admission controls, kubelet posture, kernel parameters, secure boot
and lockdown posture, and Talos machine-configuration drift.

Sources: live `talosctl` and `kubectl` state, Talos patches and version pins, current Talos and
Kubernetes advisories, official hardening guidance, and applicable CIS/NSA-CISA controls.

### 3. Workload and Namespace Isolation

Evaluate Pod Security Admission labels, security contexts, privileged containers, capabilities,
seccomp/AppArmor, host namespaces, device mounts, writable root filesystems, service-account token
mounting, resource limits, probes, disruption controls, and risky runtime configuration.

Sources: live workload specs, synthesized and source CDK8s/Helm manifests, Kubernetes Pod Security
Standards, and upstream chart documentation.

### 4. Network Segmentation and Tailscale Authorization

Review Kubernetes NetworkPolicy coverage, cross-namespace reachability, DNS and egress controls,
Tailscale grants/ACLs, tag ownership, SSH access, subnet routes, exit nodes, Funnel permissions,
device posture, node expiry, operator privileges, and policy tests.

Sources: live Kubernetes and Tailscale policy metadata, repository Tailscale constructs, official
Tailscale grants/operator documentation, and Kubernetes network-policy guidance.

### 5. Identity, RBAC, Secrets, and Supply Chain

Find over-broad ClusterRoles and bindings, default service-account use, dangerous impersonation or
secret permissions, 1Password synchronization risks, plaintext secret leaks, mutable or unpinned
images, vulnerable images and charts, unsigned artifacts, risky registries, and admission-policy
gaps.

Sources: Kubernetes RBAC and workload metadata, repository secret references and version registry,
Trivy and repository verification tools, upstream image/chart provenance, GitHub advisories, and
official Kubernetes supply-chain guidance.

### 6. Data Protection, Cloudflare R2, and Recovery

Verify storage-class protection, encryption assumptions, backup selection and exclusions, recent
Velero/OpenEBS data completeness, R2 access scope and lifecycle controls, restore readiness,
single-disk failure exposure, and recovery-point/recovery-time assumptions.

Sources: live PVC/Velero/OpenEBS state, read-only R2 object metadata, repository schedules and
storage definitions, Cloudflare R2 security documentation, and existing restore evidence.

### 7. Detection, Maintenance, and Operational Resilience

Assess audit/flow/security logging, alert coverage, runtime detection, vulnerability and dependency
update workflows, stale or unhealthy resources, configuration drift, incident evidence, and the
ability to detect and contain compromise.

Sources: live ArgoCD, Kubernetes, Talos, and observability metadata; Buildkite/verification wiring;
current upstream advisories; and relevant repository runbooks.

## Effort

- Level: Medium
- Sub-questions: 7
- Parallel investigation lanes: 3
- Target source depth: approximately 8 authoritative or primary sources per research lane where
  external guidance is material
- Maximum gap-analysis iterations: 3
- Independent adversarial review: required before final delivery

## Evidence and Rating Method

- Prefer live evidence over declared intent, and declared intent over assumptions.
- Record commands and timestamps for reproducibility, but sanitize account IDs, IPs, hostnames,
  object keys, and other sensitive topology details in durable documentation where disclosure adds
  no remediation value.
- Cross-check high-impact findings against at least two independent signals when practical.
- Rate findings as Critical, High, Medium, Low, or Informational using exploitability, exposure,
  blast radius, data sensitivity, detectability, and recovery difficulty.
- Separate confirmed findings from design risks, hardening opportunities, and unverified gaps.
- For every confirmed finding, include evidence, impact, affected assets, a concrete remediation,
  verification steps, and expected operational trade-offs.

## Deliverables

1. A repository-backed Markdown audit report under `packages/docs/decisions/`.
2. A concise executive summary and prioritized remediation table.
3. A sanitized evidence appendix with exact read-only reproduction commands.
4. A remediation backlog grouped into immediate, 30-day, and longer-term work.
5. A separate adversarial-review pass that challenges severity, evidence, and missing coverage.
6. Reader-oriented Typst and PDF renderings outside the repository after the Markdown report is
   complete; the repository plan remains raw Markdown only.

## Completion Criteria

- All seven lanes have repository and live-state coverage, or a clearly documented access gap.
- Every Critical/High finding is independently verified and has an actionable fix and validation
  procedure.
- Public exposure is reconciled across Cloudflare, Tailscale, and Kubernetes.
- Workload posture is assessed across every live namespace, not only representative pods.
- Backup health is judged from actual recent data objects and restore evidence, not status labels
  alone.
- Current upstream advisories are checked for the deployed Talos, Kubernetes, CNI, ingress,
  storage, ArgoCD, and key workload versions.
- The final report passes adversarial source and evidence review.

## Session Log — 2026-07-19

### Done

- Loaded the Kubernetes, Talos, Tailscale, Terraform/OpenTofu, Helm, ArgoCD, Git/worktree,
  homelab deployment, versioning, backup, web-fetch, and deep-research procedures.
- Created isolated worktree `.claude/worktrees/infra-security-audit-2026-07-19` on branch
  `feature/infra-security-audit-2026-07-19` from current `origin/main`.
- Defined the read-only audit boundary, seven investigation lanes, rating method, deliverables, and
  completion criteria in this plan.

### Remaining

- Obtain approval for this scope and begin repository, live-state, and current-advisory evidence
  collection.
- Reconcile findings, perform adversarial review, and deliver the final audit report and prioritized
  remediation backlog.

### Caveats

- Live Tailscale and Cloudflare coverage depends on locally available read-only credentials; any
  unavailable surface will be reported explicitly rather than inferred.
- No remediation or live-state mutation is included in the audit phase.
