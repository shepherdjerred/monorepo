---
id: reference-completed-2026-07-19-infrastructure-security-audit
type: reference
status: complete
board: false
---

# Infrastructure Security Audit

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
- Physical host, firmware, secure-boot, TPM, kernel, device, LAN, router/firewall, DNS, NTP, and
  management-plane risks that can bypass Kubernetes controls.
- Public exposure through Cloudflare DNS, tunnels, Access, R2, Tailscale ingress, Funnel,
  LoadBalancer, NodePort, host networking, and host ports.
- Application-layer posture for every live workload: authentication, authorization, trusted proxy
  handling, TLS, security headers, webhook validation, administrative endpoints, upstream security
  advisories, and access to secrets, storage, devices, and other services.
- Secret metadata and references may be inspected; secret values, credentials, tokens, private
  keys, and raw Kubernetes Secret payloads will not be collected or written to the report.
- No `apply`, `sync`, `patch`, `edit`, `delete`, `rollout`, `restart`, `reboot`, policy update,
  key rotation, or other mutating operation is authorized by this audit plan.
- Passive inspection and low-impact HTTP, DNS, TLS, and authorization checks are included. Port
  scanning, automated exploit templates, brute force, fuzzing, load testing, and proof-of-concept
  exploitation require a separately approved target list, rate limit, and maintenance window.

## Research Plan

### 1. Assets, Crown Jewels, Threat Model, and Trust Boundaries

Inventory identities, credentials, control planes, sensitive data, externally reachable assets,
critical dependencies, and recovery assets. Model realistic attack paths from an untrusted client,
compromised pod, compromised tailnet device, leaked CI credential, malicious image, LAN foothold,
and lost administrator endpoint.

Sources: repository architecture and runbooks, live asset inventories, current MITRE ATT&CK for
Containers techniques, Kubernetes threat-model guidance, and operator interviews where intent
cannot be derived safely.

### 2. External Attack Surface and Edge Security

Inventory every intended and accidental ingress path, DNS record, tunnel, Funnel endpoint,
service type, host port, and externally reachable administrative surface. Reconcile repository
intent with live listeners and routing. Review Cloudflare account roles, API token scope, MFA,
DNSSEC, registrar/domain protections, Access policies, tunnel configuration, TLS settings, WAF and
rate limiting, cache behavior, origin bypass, R2 exposure, and security logging.

Sources: Cloudflare and Tailscale live read APIs/CLIs, Kubernetes Services and Ingresses,
OpenTofu/CDK8s definitions, official Cloudflare and Tailscale security documentation.

### 3. Hardware, Firmware, Talos, and Linux Kernel Hardening

Assess physical access assumptions, UEFI and firmware currency, Secure Boot, TPM-backed identity,
disk encryption, DMA/IOMMU exposure, recovery media, Talos installer provenance, kernel lockdown,
LSM configuration, KSPP sysctls, module and eBPF policy, device permissions, time synchronization,
node API exposure, and machine-configuration drift. Account for Talos's immutable/no-shell design
rather than applying generic Linux guidance mechanically.

Sources: live `talosctl` resources, Talos machine configuration and image schematic, Sidero Labs
security documentation and advisories, Linux KSPP guidance, kernel documentation, firmware vendor
advisories, and the prior SELinux/ZFS audit.

### 4. Kubernetes Control Plane, etcd, and Cluster Governance

Assess running versions, patch currency, endpoint exposure, certificate health, API server and
etcd settings, encryption at rest, anonymous authentication, service-account issuers and token
lifetime, authorization modes, audit policy, kubelet posture, admission plugins, API priorities,
dangerous feature gates, webhook failure policies, and configuration drift.

Sources: live `talosctl` and `kubectl` state, Talos patches and version pins, current Talos and
Kubernetes advisories, official hardening guidance, and applicable CIS/NSA-CISA controls.

### 5. Identity, RBAC, Secrets, and Administrative Access

Find over-broad ClusterRoles and bindings, dangerous verbs and subresources, privilege-escalation
paths, default service-account use, unnecessary token mounts, human/admin kubeconfigs, Talos client
certificate handling, 1Password Connect/operator privileges, secret distribution and rotation,
break-glass access, MFA/recovery posture, and credential exposure in logs, state, images, or Git.

Sources: Kubernetes RBAC and service-account metadata, Talos client configuration metadata,
1Password CRDs and repository references, Cloudflare/Tailscale identity configuration, secret
scanners, and official identity/security guidance.

### 6. Admission Control, Namespace Isolation, and Policy Enforcement

Evaluate Pod Security Admission coverage and exemptions, ValidatingAdmissionPolicy or policy-engine
coverage, namespace lifecycle, default-deny controls, image and registry restrictions, required
security contexts, resource governance, unsafe sysctls, hostPath/device policies, and whether GitOps
rules are enforced at the API boundary or merely conventional.

Sources: live namespace labels, admission configuration and webhooks, synthesized manifests,
Kubernetes Pod Security Standards, NSA/CISA guidance, CIS controls, and policy-engine documentation.

### 7. Every Workload and Container

Evaluate Pod Security Admission labels, security contexts, privileged containers, capabilities,
seccomp/AppArmor, host namespaces, device mounts, writable root filesystems, service-account token
mounting, resource limits, probes, disruption controls, environment/volume secret exposure,
ephemeral containers, init containers, sidecars, and risky runtime configuration. For every live
application, review its own authentication, proxy, TLS, webhook, admin, database, plugin, and
upstream-advisory posture instead of stopping at the pod specification.

Sources: live workload specs, synthesized and source CDK8s/Helm manifests, Kubernetes Pod Security
Standards, image metadata and SBOMs, upstream chart/application documentation, GitHub advisories,
and maintainer security notices.

### 8. Kubernetes Networking, LAN, DNS, and Tailscale Authorization

Review Kubernetes NetworkPolicy coverage, cross-namespace reachability, DNS and egress controls,
Tailscale grants/ACLs, tag ownership, SSH access, subnet routes, exit nodes, Funnel permissions,
device posture, node expiry, operator privileges, and policy tests. Include CNI configuration,
service CIDRs, ARP/L2 exposure, router/NAT/firewall policy, UPnP, VLAN or IoT isolation, resolver and
NTP trust, remote administration, and lateral movement between tailnet, LAN, and cluster networks.

Sources: live Kubernetes and Tailscale policy metadata, repository Tailscale constructs, official
Tailscale grants/operator documentation, Kubernetes network-policy guidance, and read-only router
or firewall configuration when available.

### 9. Software Supply Chain, Builds, Images, Charts, and GitOps

Review source and dependency integrity, branch protections, CI/Buildkite trust, build-secret scope,
runner isolation, image build contexts, base images, multi-stage boundaries, registries, immutable
digests, chart provenance, SBOM generation, vulnerability and license scanning, artifact signing and
verification, SLSA provenance, first-party release flow, Renovate latency, GitOps repository and
ArgoCD privileges, drift, sync policy, and rollback integrity.

Sources: Dockerfiles and build definitions, Buildkite and GitHub configuration, image/chart
registries, repository version registry, Trivy and other repository checks, upstream provenance,
GitHub advisories, SLSA, NIST SSDF, and Kubernetes supply-chain guidance.

### 10. Data Protection, Storage, Backups, and Recovery

Verify storage-class protection, encryption assumptions, backup selection and exclusions, recent
Velero/OpenEBS data completeness, R2 access scope and lifecycle controls, restore readiness,
single-disk failure exposure, ransomware and malicious-delete resistance, versioning/immutability,
credential separation, off-site and offline copies, control-plane/Talos secret recovery, database
consistency, restore testing, and documented recovery-point/recovery-time assumptions.

Sources: live PVC/Velero/OpenEBS state, read-only R2 object metadata, repository schedules and
storage definitions, Cloudflare R2 security documentation, backup-provider guidance, and actual
restore evidence rather than backup status alone.

### 11. Detection, Forensics, Incident Response, and Maintenance

Assess audit/flow/security logging, alert coverage, runtime detection, vulnerability and dependency
update workflows, stale or unhealthy resources, configuration drift, incident evidence, and the
ability to detect, scope, contain, eradicate, and recover from compromise. Include log integrity and
retention, Cloudflare/Tailscale flow and admin logs, Kubernetes audit logs, Falco/eBPF trade-offs,
credential-revocation runbooks, forensic data availability, alert routing, patch SLAs, and a
tabletop compromise scenario.

Sources: live ArgoCD, Kubernetes, Talos, and observability metadata; Buildkite/verification wiring;
current upstream advisories; MITRE ATT&CK for Containers; and relevant repository runbooks.

### 12. Availability, Safety, and Architectural Blast Radius

Review single-node and single-disk failure domains, control-plane and data-plane coupling,
dependency on tailnet/Cloudflare/1Password/GitHub availability, PodDisruptionBudgets, quotas,
priority classes, denial-of-service controls, resource exhaustion, certificate/key expiry,
maintenance safety, and the security consequences of availability shortcuts. Distinguish accepted
homelab risk from accidental high-impact coupling.

Sources: live capacity and health metadata, dependency topology, disruption controls, historical
incidents, backup/restore evidence, and upstream availability/security guidance.

## Effort

- Level: High
- Sub-questions: 12
- Parallel investigation lanes: up to 3 concurrently in this environment, rotated across the 12
  lanes
- Target source depth: approximately 15 authoritative or primary sources per research lane where
  external guidance is material
- Maximum gap-analysis iterations: 4
- Independent adversarial review with source verification: required before final delivery

## Evidence and Rating Method

- Prefer live evidence over declared intent, and declared intent over assumptions.
- Record commands and timestamps for reproducibility, but sanitize account IDs, IPs, hostnames,
  object keys, and other sensitive topology details in durable documentation where disclosure adds
  no remediation value.
- Cross-check high-impact findings against at least two independent signals when practical.
- Rate findings as Critical, High, Medium, Low, or Informational using exploitability, exposure,
  blast radius, data sensitivity, detectability, and recovery difficulty.
- Map material findings to the most applicable benchmark or threat framework, but do not inflate
  severity merely because a generic benchmark control does not fit Talos or a single-user homelab.
- Separate confirmed findings from design risks, hardening opportunities, and unverified gaps.
- For every confirmed finding, include evidence, impact, affected assets, a concrete remediation,
  verification steps, and expected operational trade-offs.

## Deliverables

1. A repository-backed Markdown audit report under `packages/docs/decisions/`.
2. A concise executive summary and prioritized remediation table.
3. A sanitized evidence appendix with exact read-only reproduction commands.
4. A remediation backlog grouped into immediate, 7-day, 30-day, and longer-term work, with
   dependencies and likely outage risk.
5. A separate adversarial-review pass that challenges severity, evidence, and missing coverage.
6. Reader-oriented Typst and PDF renderings outside the repository after the Markdown report is
   complete; the repository plan remains raw Markdown only.

## Completion Criteria

- All 12 lanes have repository and live-state coverage, or a clearly documented access gap.
- Every Critical/High finding is independently verified and has an actionable fix and validation
  procedure.
- Public exposure is reconciled across Cloudflare, Tailscale, and Kubernetes.
- Workload posture is assessed across every live namespace, not only representative pods.
- Every live application receives an application-specific review, including upstream advisories and
  exposed/admin configuration, not only a generic container checklist.
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
- Expanded the audit to high effort with 12 lanes covering hardware/firmware, Linux/Talos kernel
  posture, cluster governance, every application, LAN/router risks, supply chain, incident response,
  and architectural blast radius.
- Completed read-only repository and live-state evidence collection across all 12 audit lanes,
  including the exact 66-application coverage register and a dated release/advisory matrix.
- Reconciled declared and live behavior, calibrated 25 findings through independent adversarial
  review, and produced the detailed decision record with a prioritized remediation roadmap.
- Rendered, opened, and visually inspected the six-page executive Typst/PDF report; verified report
  links, formatting, lint, and internal finding/application counts.
- Recorded the owner's repository-retention approval, tracked the Markdown report, reproducible
  Typst source, and rendered PDF together, and backed up the audit feature branch to `origin`.
- Opened [draft PR #1572](https://github.com/shepherdjerred/monorepo/pull/1572) and attached fresh
  renders of the executive cover and confirmed High-findings page for visual review.

### Remaining

- No audit-delivery or repository-retention work remains. Live remediation is a separate, mutating
  phase that has not started.
- Draft PR #1572 awaits review; no merge into `main` was requested or performed.

### Caveats

- Live Tailscale and Cloudflare coverage depends on locally available read-only credentials; any
  unavailable surface will be reported explicitly rather than inferred.
- No remediation, exploit, restore, router login, Secret-value inspection, or application-data
  inspection was authorized or performed.
- Physical-access, LAN-segmentation, Cloudflare-account-control, and application user/plugin-state
  conclusions remain conditional where the report documents an access gap.
- The owner explicitly approved repository retention of the sanitized artifacts; Secret values,
  actionable exploit procedures, and sensitive topology remain intentionally excluded.
