# Homelab infrastructure security audit

## Status

Complete — read-only assessment and independent adversarial review complete; remediation not
started.

## Audit snapshot

- **Assessment date:** 2026-07-19
- **Method:** owner-authorized, read-only configuration review, live-state inspection, and
  low-impact HTTP, DNS, TLS, and authorization checks
- **Environment:** one-node Talos Kubernetes cluster, GitOps-managed workloads, Tailscale,
  Cloudflare Tunnel and DNS, Buildkite, Velero, OpenEBS ZFS, and application workloads
- **Live platform versions:** Kubernetes 1.36.2, Talos 1.13.6, containerd 2.2.5, Linux
  6.18.38-talos, and Flannel 0.28.5
- **Safety boundary:** no Secret values, application data, backup contents, or private keys were
  read; no configuration, workload, backup, or stored application state was intentionally changed;
  no port scan, brute force, fuzzing, exploitation, or restore was attempted. Read-only API and
  HTTP checks necessarily generated ordinary access/audit logs and may have incremented
  authentication or rate-limit counters.
- **Disclosure:** this repository is public. Exploit procedures, topology identifiers, account
  identifiers, IP addresses, and raw API responses are deliberately excluded.

## Publication decision

On 2026-07-19, the owner explicitly approved preserving this sanitized audit in the repository. The
[Markdown decision](./2026-07-19_infrastructure-security-audit.md),
[reproducible Typst source](./2026-07-19_infrastructure-security-audit.typ), and
[rendered executive PDF](./2026-07-19_infrastructure-security-audit.pdf) are tracked together on the
audit feature branch. This approval covers repository retention of the sanitized artifacts; it does
not authorize live remediation or disclosure of excluded Secret values, actionable exploit
procedures, or sensitive topology.

## Executive verdict

The homelab has a credible security foundation, but several deployed controls provide less
protection than their configuration suggests. The most important example is network isolation:
49 `NetworkPolicy` objects exist, but the live Flannel installation has no network-policy
controller. Those policies are therefore declarations without enforcement.

No Critical finding was confirmed. There is no evidence of active compromise, no authentication
bypass was demonstrated, and no unauthenticated Internet-to-node path was proven. The audit did
confirm several High-severity paths in which compromise of a reachable application, a same-repo CI
job, or a trusted controller can become cluster- or node-level compromise. Recovery and forensic
controls would make that compromise difficult to investigate and recover from confidently.

The first remediation wave should:

1. add real network-policy enforcement and validate isolation behavior;
2. remove Kubernetes controller credentials from Buildkite job pods;
3. patch all Tailscale clients to the current security floor;
4. reduce the Cloudflare and 1Password operators, Alloy, SeaweedFS, Temporal, and public Argo CD
   blast radii;
5. make Kubernetes audit logs durable off-node; and
6. prove recovery with an isolated restore, including etcd and currently unprotected stateful data.

## What is already strong

- Talos provides an immutable, API-managed host with a unified kernel image, enforced module
  signatures, hardened eBPF and ptrace sysctls, and kubelet seccomp-by-default.
- Talos 1.13.6 was the current stable release during the audit. Its Linux 6.18.38 kernel is newer
  than the unaffected boundary recorded for CVE-2026-31431; that current container-pivot advisory
  does not apply to the observed kernel version.
- Kubernetes API anonymous authentication is disabled, `NodeRestriction` is enabled, Secret
  encryption at rest uses `secretbox`, and API audit logging records request metadata.
- The Tailscale policy is deny-by-omission, includes policy tests, has no Funnel grant, exposes no
  subnet route, and reserves broad access for the administrator identity.
- Cloudflare zones generally use strict origin validation, TLS 1.2 minimum, TLS 1.3, automatic
  HTTPS redirects, managed denial-of-service protection, and active DNSSEC.
- Buildkite does not build fork pull requests. GitHub secret scanning and push protection are
  enabled, and Gitleaks is a blocking repository check.
- Many first-party application images are digest-pinned. Several intentionally privileged host
  collectors correctly disable service-account token mounting.
- Velero schedules run at four intervals, the backup storage location is healthy, and recent
  Backup objects complete with volume snapshots. This is useful backup evidence even though it is
  not yet recovery evidence.
- Public webhook negative tests failed closed for the PR, agent-task, and Xcode receiver
  authentication checks tested during the audit.

## Risk model

Ratings combine reachability, prerequisite access, privilege gained, data sensitivity,
detectability, and recovery difficulty. A missing generic benchmark control is not automatically a
finding. Intentionally privileged infrastructure is rated by whether its privileges are necessary,
isolated, and recoverable.

| Rating     | Meaning in this audit                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Critical   | A practical, low-prerequisite path to complete compromise or destructive loss was confirmed.                                    |
| High       | A realistic compromise path can reach node, cluster, or crown-jewel credentials, or recovery evidence is materially inadequate. |
| Medium     | Exploitation needs a stronger prerequisite, the blast radius is bounded, or the item materially weakens defense in depth.       |
| Low        | Limited hardening, hygiene, or operational exposure with a narrow standalone impact.                                            |
| Access gap | The control could not be verified with available read-only access; it is not assumed absent.                                    |

## Prioritized findings

Finding IDs are severity-neutral so later evidence can change a rating without renumbering the
audit. After adversarial review, the report contains 7 High, 14 Medium, and 4 Low findings.

| ID   | Severity | Confidence                                  | Finding                                                                                             |
| ---- | -------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| F-01 | Medium   | Confirmed                                   | The installed Flannel deployment lacks a NetworkPolicy enforcement controller.                      |
| F-02 | High     | Confirmed                                   | Buildkite jobs inherit controller RBAC and broad Secrets in a privileged namespace.                 |
| F-03 | High     | Confirmed design risk                       | An authenticated chart publisher can feed unsigned moving artifacts into wildcard Argo CD projects. |
| F-04 | Medium   | Confirmed patch gap                         | All tailnet devices run below 1.98.9; exposure to each bulletin depends on enabled features.        |
| F-05 | High     | Confirmed design risk                       | The third-party Cloudflare operator can read and write every cluster Secret.                        |
| F-06 | Medium   | Confirmed design risk                       | Internet traffic reaches Argo CD's local-admin login and broad cluster control plane.               |
| F-07 | Medium   | Confirmed design risk                       | Alloy combines intended node privilege with unnecessary read access to every cluster Secret.        |
| F-08 | High     | Confirmed design risk                       | Public Temporal receivers share a process with infrastructure crown-jewel credentials.              |
| F-09 | High     | Confirmed privilege path                    | SeaweedFS can create Pods cluster-wide in a cluster that permits privileged infrastructure pods.    |
| F-10 | High     | Confirmed recovery gap                      | Recovery is unproven and omits critical state, control-plane evidence, and database consistency.    |
| F-11 | Medium   | Confirmed detection gap                     | Kubernetes audit evidence is node-local, short-lived, and not shipped off-node.                     |
| F-12 | High     | Confirmed design risk                       | The 1Password operator can mutate Secrets, namespaces, and application workloads cluster-wide.      |
| F-13 | Medium   | Confirmed configuration; conditional impact | Secure Boot and disk encryption are inactive; SELinux remains permissive.                           |
| F-14 | Medium   | Confirmed configuration; conditional impact | Talos control-plane listeners bind broadly and no host ingress firewall is configured.              |
| F-15 | Medium   | Confirmed                                   | PSA baseline is active, but restricted policy is advisory and custom enforcement is narrow.         |
| F-16 | Medium   | Confirmed                                   | Image and chart authenticity is not enforced across build, GitOps, and admission.                   |
| F-17 | Low      | Confirmed hardening gap                     | Tailnet Lock is disabled and administrator-device reach remains broad.                              |
| F-18 | Low      | Confirmed                                   | Home Assistant trusts all IPv4 addresses as reverse proxies.                                        |
| F-19 | Medium   | Confirmed                                   | Tailscale ingress proxies share Secret-management authority.                                        |
| F-20 | Medium   | Confirmed                                   | PinchTab is an unsandboxed browser with ineffective network isolation.                              |
| F-21 | Low      | Confirmed dormant drift                     | Scaled-zero Dagger resources preserve a node-privileged template.                                   |
| F-22 | Medium   | Confirmed                                   | Resource governance and single-node availability controls are incomplete.                           |
| F-23 | Low      | Volatile operational signal                 | Drift and health are not consistently self-healed or security-gated.                                |
| F-24 | Medium   | Confirmed detection gap                     | Runtime detection and event-export coverage are insufficient for the trust level.                   |
| F-25 | Medium   | Confirmed patch/drift gap                   | The live cloudflared deployment is outside support and differs from the declared image.             |

## Detailed findings

### F-01 — NetworkPolicy is not enforced (Medium)

**Evidence.** The cluster contains 49 `NetworkPolicy` objects across 19 namespaces. The only live
pod-network implementation is Flannel 0.28.5. Its DaemonSet has the Flannel containers but no
`kube-network-policies`, Calico, Cilium, kube-router, or other policy controller. Flannel's own
documentation states that NetworkPolicy requires a separate controller or the chart's network
policy option.

**Impact.** Workloads can make lateral connections that their manifests appear to deny. This
invalidates isolation assumptions around public receivers, browser automation, internal databases,
Tailscale proxies, Argo CD, and observability. A compromised pod does not need to defeat the
declared policies because no component is enforcing them.

**Remediation.** Deploy the Kubernetes SIGs network-policy controller supported by Flannel, or
migrate to a policy-capable CNI. Treat the existing policies as untrusted input until they are
validated. Add namespace default-deny ingress and egress, explicit DNS rules, public-receiver egress
restrictions, and tests for both allowed and denied paths.

**Verification.** From disposable test pods in distinct namespaces, prove that default-denied
connections fail and explicitly allowed connections succeed. Test cluster services, pod IPs,
link-local addresses, node addresses, and Internet egress. Keep these behavioral checks in CI or a
post-deploy conformance job.

**Trade-off.** Enabling enforcement can break applications whose policies were never exercised.
Roll out by namespace with observed connection baselines and an explicit rollback path.

### F-02 — Buildkite job and controller identities are collapsed (High)

**Evidence.** Same-repository pull requests run in Buildkite; external fork builds are disabled and
repository write access is tightly held. The bootstrap uploads the pipeline definition from the
checked-out branch. Common jobs receive the full `buildkite-ci-secrets` bundle and mount the
controller service-account token. The associated Role can create and update Jobs, delete Pods, and
read all Secrets in the Buildkite namespace. Privileged jobs use TLS-disabled Docker-in-Docker, the
namespace permits privileged workloads, and no admission policy prevents this identity from
creating a host-access job. Authorization checks confirmed the Kubernetes capabilities without
creating a workload.

**Impact.** Any command execution in a same-repo CI step, compromised CI dependency, or compromised
job image can cross from build execution into Buildkite credentials and node-level workload
creation. Disabling fork builds lowers likelihood but does not provide isolation from a compromised
maintainer account, dependency, or base image.

**Remediation.** Give job pods a dedicated service account with no Kubernetes RBAC and
`automountServiceAccountToken: false`. Keep the controller identity only on the controller. Split
untrusted PR, trusted-main, deploy, and privileged-builder queues or namespaces. Restrict each job
to its exact Secret fields, and enforce an admission rule that denies privileged, host namespace,
and hostPath workloads except for a narrowly named builder identity.

**Verification.** Impersonate the job service account and prove it cannot read Secrets, create
Jobs or Pods, use `pods/exec`, bind RBAC, or create privileged workloads. Run the ordinary and
privileged pipelines after the split.

### F-03 — Unsigned moving charts enter a wildcard GitOps trust domain (High)

**Evidence.** Custom applications consume anonymously readable ChartMuseum charts through a moving
compatible version range. Chart writes are authenticated, but no Helm provenance, OCI signature,
or admission-time image signature is verified. All 66 Argo CD Applications use the default project,
which permits wildcard sources, destinations, and resource kinds. Automated sync is enabled for
all applications.

**Impact.** An authenticated ChartMuseum writer, compromised storage credential, publishing job, or
already permitted source can introduce a new matching chart version. Automated sync then accepts
that version, while the wildcard project permits cluster-wide and privileged resources. The
wildcard project does not independently let an anonymous party add a source. Digest-pinned
container images do not protect the surrounding manifests.

**Remediation.** Publish immutable chart artifacts with provenance or Sigstore signatures and pin
an exact immutable reference supported and verified by the chosen repository mechanism. Create
Argo CD AppProjects that allow only the required repository, destination namespace, and resource
kinds for each trust class. Add admission verification for trusted image registries and
signatures, with an explicit break-glass process.

**Verification.** Prove that an unsigned chart or image, an unapproved repository, an unapproved
namespace, and a cluster-scoped resource from an application project are all rejected.

### F-04 — Tailscale security patch floor is not met (Medium)

**Evidence.** The tailnet contains 49 authorized devices, and the API marks every one as having an
update available. Deployed versions range from 1.90.6 through 1.98.8. Tailscale's current security
bulletins set 1.98.9 as the fixed version for multiple Serve, Funnel, SSH, service, and local-socket
issues. Two devices have Tailscale SSH enabled.

**Impact.** The tailnet is a management security boundary. The bulletins are feature- and
prerequisite-specific, so `updateAvailable` does not prove that every device is affected. Operator
ingress proxies using Serve and the two SSH-enabled devices warrant priority; no exploitation or
additional root privilege was demonstrated in this tailnet.

**Remediation.** Upgrade administrator endpoints and Tailscale SSH devices first, then the Talos
extension and all operator proxies, to 1.98.9 or later. Establish a patch SLA and alert when a
security bulletin raises the minimum safe version. Confirm that no endpoint is stranded on an
unsupported operating system.

**Verification.** Re-query the device inventory and require zero `updateAvailable` devices and zero
versions below the bulletin floor. Re-run policy tests and management access checks after upgrades.

### F-05 — Cloudflare operator is a cluster-wide credential authority (High)

**Evidence.** The deployed third-party Cloudflare operator is an alpha/hobby project rather than an
official Cloudflare controller. Its ClusterRole can create, read, update, and delete Secrets,
ConfigMaps, Deployments, and Services throughout the cluster. The operator image is tag-only.

**Impact.** A vulnerability or supply-chain compromise in this controller exposes every Kubernetes
credential and can modify workloads and public routes. This is a crown-jewel controller whose
current trust exceeds its required tunnel-management role.

**Remediation.** Prefer an official/static cloudflared Deployment with tunnel and DNS configuration
managed through narrowly scoped IaC. If the operator remains, pin its digest, isolate its namespace
and identity, reduce Secret access to named resources, and prevent it from mutating unrelated
workloads.

**Verification.** Impersonate the operator service account and prove it cannot read or mutate an
unrelated Secret, Deployment, Service, or namespace.

### F-06 — Public Argo CD retains a high-impact local administrator (Medium)

**Evidence.** An unauthenticated request through the public Cloudflare Tunnel route reached Argo
CD's own login surface without an observed Access challenge. Account-side Access configuration was
not readable, so this audit does not assert that no Access application exists. Anonymous API access
correctly returns unauthorized. The built-in administrator remains enabled for login and API keys.
Argo's server and application-controller roles can mutate broad cluster resources, every
Application belongs to the wildcard default project, and the route disables origin TLS
verification. No authentication bypass was found, and the documented default login rate limiter
appears active.

**Impact.** Theft, reuse, or successful attack against the local administrator credential becomes
a public-to-cluster control-plane path. Internet reachability to the application login surface adds
exposure even though Argo authentication is functioning.

**Remediation.** Make Argo tailnet-only or put it behind Cloudflare Access with phishing-resistant
MFA. Configure SSO, disable the built-in administrator for routine use, and preserve a tested
offline break-glass path. Split AppProjects by trust and namespace. Restore authenticated origin
TLS and remove `noTlsVerify`.

**Verification.** An unauthenticated Internet client should receive an Access challenge or no route.
Normal users should authenticate through SSO and lack administrator privileges. The local admin
should be disabled, or a documented break-glass test should prove it is offline and monitored.

### F-07 — Alloy combines node privilege with all cluster Secrets (Medium)

**Evidence.** The Alloy DaemonSet runs privileged, with host PID access, as root, and with a writable
root filesystem. Its bound ClusterRole can list, watch, and read every Secret. It is not directly
publicly exposed; compromise requires a container, supply-chain, or lateral-access prerequisite.

**Impact.** One Alloy compromise can obtain node-level access and collect cluster-wide credentials.
Combining host observability and Kubernetes Secret discovery turns an observability agent into a
single-step cluster compromise target.

**Remediation.** Remove Secret and unrelated ConfigMap permissions. Separate privileged profiling
from ordinary log/metric collection. Replace full privilege with Grafana's documented minimum eBPF
capabilities and read-only tracefs mounts where the Talos/kernel combination supports them. Pin the
image digest and isolate the agent with enforced network policy.

**Verification.** Prove the Alloy identity cannot get, list, or watch Secrets. Validate profiling,
logs, and metrics after reducing capabilities, and prove the pod cannot write host paths or reach
unnecessary service networks.

### F-08 — Public Temporal receivers share crown-jewel credentials (High)

**Evidence.** Three public webhook/API routes terminate in a Temporal worker container. Negative
authentication tests failed closed, which is positive. The same container receives a GitHub App
private key and installation identity, a Talos administrator configuration, and credentials or
tokens for agent tasks, Xcode, object storage, Cloudflare, Argo CD, Buildkite, Grafana, PagerDuty,
Home Assistant, and LLM providers. Several external-token scopes were not independently verified.
Its Kubernetes identity also has namespaced `pods/exec` permissions in infrastructure namespaces.

**Impact.** A parser, framework, dependency, or business-logic vulnerability in any public receiver
lands directly inside a process holding infrastructure-wide credentials. Correct bearer and
signature checks reduce likelihood but do not contain a post-authentication or implementation
compromise. The previously accepted broad worker functionality does not require public request
parsing to share the same process and credentials.

**Remediation.** Split minimal public receiver pods from privileged workers. Receivers should
validate authentication, content type, body size, replay window, and schema, then enqueue a narrow
typed message without infrastructure credentials. Put the agent-task route behind Access or mTLS.
Split workers and credentials by function while preserving intentionally broad agent behavior only
where needed.

**Verification.** Inspect receiver pod environments and service accounts to confirm that they have
no operational credentials beyond queue publishing. Exercise valid, invalid, oversized, replayed,
and malformed requests in a test environment and confirm fail-closed behavior.

### F-09 — SeaweedFS has unnecessary cluster-wide escalation paths (High)

**Evidence.** The SeaweedFS service account is bound to a ClusterRole that permits Pod creation and
mutation across namespaces. Its namespace permits privileged pods. Core SeaweedFS images are
tag-only and lack explicit workload hardening.

**Impact.** Remote code execution or a supply-chain compromise in SeaweedFS can create a privileged
host-access pod and take over the node.

**Remediation.** Remove cluster-wide Pod permissions or scope any necessary controller operations
to the SeaweedFS namespace. Disable unnecessary token mounting, pin image digests, and add explicit
non-root, seccomp, privilege-escalation, and filesystem controls where supported.

**Verification.** The SeaweedFS identity must be unable to create a Pod outside its namespace or a
privileged Pod anywhere.

### F-10 — Backups are not yet proven recovery (High)

**Evidence.** All 26 retained Velero Backup objects report completion, and the newest backup
contains 141 resources and 42 volume snapshots. There are no Restore objects. Of 66 PVCs, 42 are
backup-enabled, 4 are intentionally disabled, and 20 are unlabeled. Unprotected state includes
SeaweedFS metadata/data, Temporal PostgreSQL, Postal MariaDB, several game worlds, and observability
data. The latest Postal backup contains the application PVC but not its database PVC. No database
hooks or native point-in-time recovery were observed. No automated etcd snapshot or restore
evidence, or independently tested Talos machine/CA recovery, was found. Object storage contains
many historical snapshot prefixes that do not correspond one-to-one with retained Backup objects;
deleting them without chain analysis would be unsafe.

**Impact.** Successful backup jobs can still produce an incomplete or application-inconsistent
recovery. A node loss, credential compromise, ransomware event, or malicious backup deletion may
leave no proven path to restore the control plane and critical state within an understood RPO/RTO.

**Remediation.** Classify every PVC explicitly as protected or intentionally disposable. Protect
critical databases with native consistent backup/PITR in addition to volume snapshots. Automate
off-node etcd snapshots and preserve Talos machine configuration, CA, and bootstrap recovery
material independently. Add object lock/versioning or a separately credentialed immutable copy
where supported. Do not garbage-collect historical snapshot objects until the reference graph is
understood.

**Verification.** Run an isolated, documented restore of the cluster control plane and at least one
representative database-backed application. Verify data integrity, credentials, ingress, and an
agreed RPO/RTO. Repeat on a schedule and record restore evidence.

### F-11 — Audit evidence is short-lived and node-local (Medium)

**Evidence.** The Kubernetes API records Metadata-level audit events with ten approximately 100 MB
rotations plus the current file. During the 2026-07-19 observation window, the rotated timestamps
covered about 3.6 hours; this duration varies with request rate. The audit directory is not mounted
into Promtail or another off-node collector. Loki is a single local-filesystem replica whose live
PVC is not backup-enabled. No independent immutable forensic log store was found.

**Impact.** A node compromise, destructive event, or delayed investigation can erase or age out the
evidence needed to identify the initial identity, affected resources, and containment scope. Local
Loki loss would remove much of the remaining application evidence at the same time.

**Remediation.** Ship Kubernetes audit events directly to a separately credentialed off-node store
with an explicit retention and integrity policy. Tune the audit policy to retain authorization,
Secret metadata access, exec/attach, RBAC, admission, and workload mutation signals without logging
Secret values. Back up or replicate security-relevant Loki data separately from the node.

**Verification.** Generate a benign audited action, locate it in the remote store, prove the node
cannot delete historical records, and confirm the event remains searchable after the target
retention period. Tabletop a compromised service-account investigation using only retained data.

### F-12 — 1Password operator is a cluster-wide credential and workload authority (High)

**Evidence.** The live 1Password Connect operator ClusterRole can create, delete, read, list,
watch, patch, and update Secrets, ConfigMaps, namespaces, Pods, Services, PVCs, Deployments,
DaemonSets, StatefulSets, and ReplicaSets cluster-wide. Connect holds access to the vault items it
synchronizes. No misuse or Secret-value exposure was observed.

**Impact.** Operator or Connect compromise can collect synchronized credentials, create or replace
application workloads, and use those workloads to expand impact. The combined Secret and workload
authority makes this controller a crown jewel comparable to GitOps and edge controllers.

**Remediation.** Restrict the operator to explicitly watched namespaces and the resource kinds it
actually reconciles. Separate high-impact vault items and workloads into distinct operator trust
domains where practical. Pin images, minimize the Connect vault token scope, and alert on unusual
Secret enumeration or workload mutation by this identity.

**Verification.** Impersonate the operator service account and prove it cannot read an unrelated
Secret, create a namespace, or mutate an application workload outside its declared scope. Test
Secret rotation and recovery after the restriction.

## Additional findings

### F-13 — Physical and boot-chain protections are incomplete (Medium)

The node boots a signed unified kernel image and enforces module signatures, but firmware Secure
Boot is off. STATE, EPHEMERAL, and data storage show no disk encryption. SELinux is enabled in
permissive mode, and kernel lockdown is intentionally set to integrity rather than confidentiality
to support Alloy eBPF. This is a Medium conditional risk: it matters most if an attacker can steal
the node or disk, boot alternate media, or gain physical DMA access. Enable firmware Secure Boot,
add Talos disk encryption with a tested recovery-key design, investigate IOMMU support, and move
SELinux toward enforcing only after the remaining policy/noise work is complete. Do not sacrifice a
tested recovery path for nominal encryption coverage.

### F-14 — Host control-plane exposure depends on an unverified LAN boundary (Medium)

Talos API, trustd, Kubernetes API, kubelet, etcd, and host services bind broadly; Talos has no host
ingress firewall rules. Broad binding is not proof of external reachability, and Tailscale policy
does not filter LAN traffic. A passive gateway check found an HTTP login page on the standard LAN
management port and no response on the standard HTTPS port; it did not prove WAN exposure or the
absence of HTTPS on every port. Authenticated router configuration was not inspected. From a real
LAN client, verify VLAN/guest/IoT separation, WAN administration, UPnP, WPS, IPv6 firewall behavior,
port forwards, resolver/NTP trust, router firmware, and node control-plane reachability. Prefer
HTTPS-only router administration on a dedicated management network and a Talos ingress allowlist
for management APIs.

### F-15 — Admission is permissive relative to workload privilege (Medium)

Talos enforces PSA baseline in unlabeled namespaces; restricted policy is audit/warn, and several
infrastructure namespaces explicitly opt into `privileged`. Kyverno has only two ClusterPolicies;
resource-limit validation is audit-only and Buildkite-scoped. There are no
ValidatingAdmissionPolicies. Build enforceable policy classes for ordinary apps, controllers, host
collectors, storage, and CI. Require explicit service-account token intent, privilege-escalation
settings, capabilities, host-access allowlists, approved registries, and resource bounds without
pretending that necessary Talos/storage agents can satisfy the restricted profile.

### F-16 — Artifact authenticity is not enforced (Medium)

At 12:37 PDT on 2026-07-19, 105 of 166 long-running Deployments, StatefulSets, and DaemonSets
referenced at least one image without an `@sha256` digest. CI vulnerability scanners include
soft-fail paths, there is no required SBOM/signature/attestation gate, and several bootstrap
downloads do not verify checksums or signatures. GitHub code scanning has a large untriaged alert
backlog and is not a required merge gate; alert labels are posture evidence, not proof that each
item is exploitable. The repository ruleset does not require review, signed commits, or code-scanning
success, and administrators can bypass it. Generate SBOMs and provenance in CI, sign release
artifacts, verify them at admission, pin privileged controllers and host agents first, make security
scanners blocking with a documented exception process, and checksum every bootstrap download.

### F-17 — Tailnet Lock is disabled and administrator reach is broad (Low)

The ACL is materially better than the former allow-all policy, but the administrator identity can
reach every tailnet destination and Tailnet Lock is off. Forty-two devices have key expiry disabled;
most are tagged proxies, for which disabled expiry is Tailscale's documented default rather than
evidence of long-lived human credentials. Enable Tailnet Lock after rehearsing signer recovery, use
posture-aware grants or an admin-device tag for management planes, separate proxy trust groups, and
review non-expiring device necessity. Preserve enough independent signers to avoid lockout.

### F-18 — Home Assistant trusts arbitrary forwarded client addresses (Low)

Home Assistant is publicly routed and configures `trusted_proxies` as all IPv4 addresses. This lets
an unintended direct or lateral client supply forwarding headers and weakens source attribution and
IP-ban logic; no authentication bypass was demonstrated. Trust only the exact cloudflared or reverse
proxy sources, enable explicit login-attempt banning, and firewall any direct host-network listener.

### F-19 — Tailscale proxies share Secret-management authority (Medium)

Generated ingress proxies share one service account that can manage every Secret in the Tailscale
namespace, including other proxies' state, and their pods mount the token by default. Compromise of
one proxy can therefore cross proxy identities. Apply a hardened ProxyClass and use supported
per-proxy RBAC, separate operator namespaces/trust groups, or explicitly document acceptance after
testing. Do not disable token mounting until the state-Secret behavior has been proven compatible.

### F-20 — PinchTab is a browser-session and lateral-network pivot (Medium)

Bearer authentication and disabled service-account tokens are positive. Chrome nevertheless runs
without its sandbox, profiles and cookies persist, and the browser can request arbitrary URLs.
Because F-01 confirms that the expected policy boundary is not enforced, the browser is
network-unrestricted and can target cluster-private, node, link-local, and Internet services. It is
not publicly exposed. Place browser automation in a separately enforced network and runtime
boundary, route egress through a policy proxy that rejects private/link-local/service CIDRs,
separate profiles/tokens by consumer, and enable the browser sandbox if upstream supports it.

### F-21 — Retired Dagger resources remain deployable (Low)

Dagger source was removed, but the live Argo Application, StatefulSet, Services, registry Secret
mount, and PVC remain. The StatefulSet is scaled to zero and has no pods or endpoints, so this is
not an active exposed service. Its template retains full privilege, all capabilities, host access,
and a plaintext service if rescaled. Deliberately delete the stale objects after deciding whether
the cache data must be preserved; add orphan/drift detection for applications removed from Git.

### F-22 — Resource governance leaves denial-of-service paths (Medium)

There is no ResourceQuota and only one LimitRange. At 12:38 PDT on 2026-07-19, 120 of 166
long-running Deployments, StatefulSets, and DaemonSets had at least one container or init container
without both CPU and memory limits. Talos has strong kubelet reservations and PID limits, but the
cluster is a single node with control-plane scheduling enabled, so workload exhaustion affects
every service and the control plane. Introduce conservative, observed quotas and limits by workload
class; prior etcd event-storm behavior means this must be staged and monitored rather than applied
globally at once. Use PriorityClasses and eviction behavior to protect DNS, storage, networking,
GitOps, and recovery-critical workloads.

### F-23 — Live drift and unhealthy applications weaken assurance (Low)

At 12:19 PDT on 2026-07-19, 4 of 66 Argo CD Applications were OutOfSync, 2 were Progressing, and 1
was Degraded. Health changed during the audit, demonstrating that this is a volatile operational
signal rather than a fixed security finding. Only two applications had both pruning and self-heal
enabled. Availability errors are not automatically security vulnerabilities. Define which apps
must self-heal, alert on verified security-control drift, require health before promotion, and
separately resolve application failures without bulk-syncing the cluster.

### F-24 — Runtime and event detection do not match the trust level (Medium)

No Falco, Tetragon, Tracee, or equivalent runtime detection is deployed. No matching Kubernetes
event streams were found in the reviewed seven-day Loki window; this is evidence of ineffective
current delivery, not proof that no event was ever delivered. The running exporter still used a
shorter event age than its current ConfigMap, indicating rollout drift. PagerDuty had numerous
unacknowledged active incidents routed through a single-user, high-urgency design. First make audit
and event collection reliable, then add a small number of high-value detections for exec/attach,
service-account anomalies, privileged workload creation, Secret enumeration, RBAC changes, and
unexpected host access. Avoid adding a high-volume runtime sensor before retention and response
ownership exist.

### F-25 — cloudflared is outside support and differs from declared state (Medium)

The live tunnel runs cloudflared 2025.4.0, older than Cloudflare's one-year supported-version
window, while the repository declares a newer digest-backed image that the operator-generated
Deployment did not propagate. This is a patch and reconciliation failure, separate from the
Cloudflare operator's High RBAC blast radius. Make the image pin part of the generated Deployment,
upgrade to a currently supported release, alert on source/live drift, and confirm the live digest
matches the declaration.

## Low and informational observations

- The filer-embedded SeaweedFS S3 endpoint answered an anonymous bucket-list request with an empty
  result; the dedicated S3 gateway denied the request. No object exposure was demonstrated. Disable
  or authenticate the unused secondary surface.
- DNSSEC was active on nine of ten reviewed zones; one zone remained pending. Confirm delegation
  completion before treating it as protected.
- The Talos Tailscale extension configuration contains duplicate `TS_AUTHKEY` and `TS_ACCEPT_DNS`
  entries from append-style patching. Persisted proxy state means the key is not currently consumed,
  but clean the duplication before the next key rotation.
- The local talosctl client was one patch behind the server. Align versions during routine tooling
  maintenance; no incompatibility was observed.
- The node uses one unauthenticated external SNTP source. A second independent source and monitoring
  would improve resilience against time failure; no time manipulation was observed.

## Accepted high-trust workloads

These components remain security-sensitive even when their privilege is functionally justified:

- **Velero** is bound to `cluster-admin` and holds backup credentials. Treat the controller and
  repository as crown jewels; prefer short, backup-only credentials, immutable copies, digest pins,
  and restore testing.
- **Z-Wave JS UI** needs one serial device and currently runs privileged. Its service-account token
  is already disabled. Reduce to the device, groups, and capabilities actually required.
- **Gluetun/qBittorrent** uses a privileged VPN sidecar, but images are digest-pinned, the pod has no
  service-account token, qBittorrent is bound to the tunnel interface, and UPnP is disabled. Replace
  full privilege with the TUN device and minimum network capabilities while preserving fail-closed
  behavior.
- **Home Assistant and Scrypted** use host networking for discovery. Treat every node-interface
  listener as part of the LAN perimeter even when it is not publicly tunneled.
- **OpenEBS, ZFS, NVMe, SMART, node-exporter, Flannel, kube-proxy, and tuning agents** need host or
  kernel access. Separate them from ordinary application namespaces, pin their artifacts, remove
  unused tokens, and allow only their exact capabilities and paths.
- **Promtail** is upstream-retired. Migrate log collection to a separate nonprivileged Alloy
  instance rather than combining it with the privileged profiling agent.

## Realistic attack paths

The following paths were validated as architectural chains, not exploited:

1. **Same-repo CI execution → controller identity → privileged node workload.** F-02 collapses the
   build and cluster-controller boundaries.
2. **Public receiver vulnerability → co-resident infrastructure credentials.** F-08 turns an
   application exploit into control-plane credential exposure without a second isolation boundary.
3. **Controller or artifact compromise → wildcard GitOps/admission → node privilege.** F-03, F-05,
   F-09, and F-12 concentrate trust in components that can change workloads or obtain credentials.
4. **Compromised pod → unrestricted lateral movement.** F-01 allows a foothold such as browser
   automation or a public application to probe internal services despite declared policies.
5. **Node or administrator compromise → weak evidence and uncertain recovery.** F-10 and F-11 make
   destructive impact harder to scope and reverse.

## Remediation roadmap

### Immediate: 0–72 hours

| Priority | Action                                                                                                   | Outage risk | Proof of completion                                                           |
| -------- | -------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| 1        | Upgrade every Tailscale client to 1.98.9 or later, prioritizing admin and SSH endpoints.                 | Low–medium  | No device below the security floor; ACL tests pass.                           |
| 2        | Remove controller tokens and RBAC from Buildkite job pods; split trusted and untrusted queues.           | Medium      | Job identity cannot read Secrets or create workloads; pipelines pass.         |
| 3        | Restrict or temporarily isolate the Alloy Secret role and SeaweedFS cluster-wide Pod role.               | Medium      | Impersonation checks deny unrelated Secret/Pod access; services stay healthy. |
| 4        | Place Argo CD behind Access or make it tailnet-only; rotate/retire routine local admin use.              | Medium      | Public client receives Access/no route; SSO/admin tests pass.                 |
| 5        | Patch cloudflared to a supported digest-pinned release and reconcile the live/source drift.              | Low         | Live digest and version match declared supported release.                     |
| 6        | Preserve current audit logs and backup metadata before changes; do not delete orphan-looking R2 objects. | Low         | Evidence copied to a protected analysis location; no backup objects removed.  |

### Within 7 days

| Priority | Action                                                                                         | Outage risk | Proof of completion                                                         |
| -------- | ---------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| 1        | Install a NetworkPolicy enforcer and validate existing policy behavior namespace by namespace. | High        | Denied/allowed conformance matrix passes from disposable test pods.         |
| 2        | Split Temporal receivers from privileged workers and credentials.                              | Medium–high | Receiver pods contain only queue credentials; negative tests still pass.    |
| 3        | Replace or sharply scope the Cloudflare operator.                                              | Medium      | Operator cannot access unrelated Secrets/workloads; tunnels remain healthy. |
| 4        | Ship Kubernetes audit logs to an independent off-node destination.                             | Medium      | Benign action is searchable remotely after local rotation.                  |
| 5        | Disable or authenticate the filer-embedded S3 endpoint.                                        | Low         | Every anonymous S3 request is denied.                                       |
| 6        | Correct Home Assistant proxy trust and restrict direct host-network access.                    | Medium      | Only intended proxy sources are accepted; client attribution is correct.    |
| 7        | Explicitly classify all 66 PVCs and protect missing critical databases/state.                  | Medium      | Every PVC has a reviewed protection/disposable decision.                    |

### Within 30 days

| Priority | Action                                                                                            | Outage risk | Proof of completion                                                    |
| -------- | ------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| 1        | Run an isolated etcd, Talos, and database-backed application restore drill.                       | Medium–high | Recorded RPO/RTO and integrity checks succeed.                         |
| 2        | Create least-privilege Argo CD AppProjects and pin/sign chart artifacts.                          | Medium      | Negative trust-boundary tests reject unapproved sources/resources.     |
| 3        | Add image SBOM, provenance, signature, and admission verification for privileged workloads first. | Medium      | Unsigned artifact test is rejected; signed release deploys.            |
| 4        | Roll out workload-class admission policies and service-account-token defaults.                    | Medium–high | Ordinary apps meet restricted policy; exceptions are named and tested. |
| 5        | Segment PinchTab and Tailscale proxy identities and networks.                                     | Medium      | Cross-group Secret and private-network tests fail.                     |
| 6        | Remove dormant Dagger resources and resolve security-sensitive Argo drift.                        | Low–medium  | No stale app/workload remains; intended PVC disposition is recorded.   |
| 7        | Establish runtime/event detections and an owned incident triage path.                             | Medium      | Tabletop signals arrive with adequate context and manageable volume.   |

### Longer-term

- Enable firmware Secure Boot and encrypted Talos volumes with a rehearsed recovery-key design.
- Add management VLAN/LAN segmentation and a Talos host ingress allowlist after router visibility is
  available.
- Enable Tailnet Lock with independent signers and a documented recovery ceremony.
- Add native database PITR, backup immutability, and regular automated restore exercises.
- Introduce conservative ResourceQuota, LimitRange, PriorityClass, and workload availability policy.
- Reduce full privilege across hardware/VPN/observability agents without breaking required kernel or
  device access.
- Move SELinux from permissive to enforcing after the ZFS/container label policy is stable and
  tested.

## All-application coverage register

The live inventory reconciled exactly: 66 matrix entries, 66 live Argo CD Application names, zero
missing, and zero extra. Exposure totals are 20 public, 11 tailnet, 6 LAN, 22 internal, and 7 with
no observed inbound endpoint. `LAN*` means a NodePort was confirmed, but router/WAN forwarding was
not. “Internal” includes cluster-only controllers and Services; “none” means no inbound endpoint was
observed.

At 12:19 PDT on 2026-07-19, health was 63 Healthy, 2 Progressing, and 1 Degraded; sync was 62 Synced
and 4 OutOfSync. The counts changed during review and are explicitly point-in-time. Shared inherited
concerns are omitted from individual rows: NetworkPolicy is currently ineffective, all apps use the
wildcard default AppProject, most apps lack self-heal, and custom ChartMuseum charts use unsigned
moving versions.

| Application                    | Exposure | Privilege or trust posture                              | Application-specific observation                                                                   | Disposition                                                                   |
| ------------------------------ | -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `1password`                    | Internal | Cluster Secret broker                                   | Operator compromise can expose synchronized workload Secrets.                                      | Compartmentalize and minimize Secret RBAC.                                    |
| `alloy`                        | Internal | Host-privileged observability; cluster Secret reader    | Privileged, host-PID, root workload can read all Kubernetes Secrets.                               | Immediate: remove Secret RBAC and reduce host privilege.                      |
| `apps`                         | None     | GitOps meta-application                                 | OutOfSync; wildcard project and mutable chart path amplify supply-chain compromise.                | Immediate: constrain the project and make artifacts immutable and verifiable. |
| `argocd`                       | Public   | Cluster-wide GitOps control plane                       | Internet-facing local-admin login; server role can make broad cluster changes.                     | Immediate: edge Access/SSO, break-glass admin, least privilege.               |
| `birmel`                       | Public   | Secret-bearing bot and agent                            | Public OAuth callback plus intentionally broad tools increases token and command-execution impact. | Retain accepted capability only with owner checks and isolation.              |
| `blackbox-exporter`            | Internal | Active network prober                                   | Probe configuration can become an SSRF or lateral-reconnaissance oracle.                           | Allowlist targets and constrain egress.                                       |
| `bugsink`                      | Public   | Sensitive telemetry and database                        | Public ingestion stores stack traces and operational data; abuse and recovery need testing.        | Review rate limits and authentication; run a restore drill.                   |
| `buildkite`                    | Internal | CI orchestrator and privileged job factory              | Same-repo CI can create privileged host-access jobs and read namespace Secrets.                    | Immediate: split controller/job identities and per-step Secrets.              |
| `cert-manager`                 | Internal | Cluster PKI and Secret controller                       | OutOfSync high-trust controller; issuer and certificate-authority scope is broad.                  | Reconcile, then review issuer and RBAC boundaries.                            |
| `chartmuseum`                  | Public   | Deployment artifact registry                            | Public registry feeds unsigned moving chart ranges into automated GitOps.                          | Immediate: immutable signed releases and tightly controlled writes.           |
| `cloudflare-operator`          | Internal | Edge-routing operator with broad RBAC                   | Third-party alpha controller can manage Secrets and workloads cluster-wide.                        | Immediate: replace or sharply scope.                                          |
| `cloudflare-tunnel`            | Public   | Public edge conduit                                     | Tunnel binary is outside the support floor and live image identity is not pinned.                  | Immediate: upgrade, digest-pin, and validate origin TLS.                      |
| `dagger`                       | None     | Dormant host-privileged build engine                    | OutOfSync, scaled-zero template retains privilege, host access, and a registry Secret.             | Remove stale application and resources deliberately.                          |
| `ddns`                         | None     | Root DNS updater with zone credentials                  | Container compromise can rewrite public DNS.                                                       | Use least-privilege token and non-root execution where supported.             |
| `freshrss`                     | Public   | Stateful web/feed parser                                | Public parser fetches attacker-controlled remote content and holds user credentials.               | Patch, authenticate, and constrain egress.                                    |
| `gickup`                       | None     | Credentialed repository mirror                          | Provider tokens and mirrored source make compromise an exfiltration and supply-chain risk.         | Scope tokens and test repository recovery.                                    |
| `golink`                       | Tailnet  | Embedded tailnet service                                | Long-lived tsnet state uses a high-trust tag rather than a dedicated low-privilege identity.       | Create a dedicated tag, ACL, and key lifecycle.                               |
| `grafana-db`                   | Internal | Stateful authentication/configuration database          | No distinct concern found beyond recovery dependency.                                              | Retain verified backup/restore coverage.                                      |
| `home`                         | Public   | Smart-home control plane with host-integrated workloads | Public UI shares a namespace with host-network and hardware-access workloads.                      | Immediate: fix proxy trust and isolate host-integrated components.            |
| `intel-device-plugin-operator` | Internal | Cluster device controller                               | No distinct concern found beyond necessary controller RBAC.                                        | Monitor and pin; review RBAC on upgrades.                                     |
| `intel-gpu-device-plugin`      | Internal | Node device plugin with host paths                      | Kubelet socket, device, and sysfs access create a node-trust boundary.                             | Use a dedicated admission exception and minimum mounts.                       |
| `kueue`                        | Internal | Cluster workload-admission controller                   | No distinct application-specific concern found.                                                    | Monitor controller RBAC and admission availability.                           |
| `kyverno`                      | Internal | Cluster admission controller                            | Engine is high trust, but the deployed enforce-policy set is very small.                           | Immediate: expand tested enforce-mode controls.                               |
| `kyverno-policies`             | None     | Admission policy bundle                                 | OutOfSync; important resource policy remains audit-only and narrowly scoped.                       | Immediate: reconcile, stage, then enforce.                                    |
| `loki`                         | Tailnet  | Sensitive log store                                     | Single local copy is not a trustworthy off-node forensic record.                                   | Immediate: off-node retention and tested recovery.                            |
| `mario-kart`                   | Public   | Public bot/game UI                                      | Public input-processing surface; it recovered to Healthy during the audit.                         | Review authentication and rate limits.                                        |
| `mc-router`                    | LAN\*    | Shared game-protocol front door                         | NodePort exposes plaintext game routing; WAN/NAT and abuse controls are unverified.                | Verify router exposure, rate limits, and allowlists.                          |
| `mcp-gateway`                  | Tailnet  | Concentrated tool gateway                               | One tailnet client may inherit authority across multiple downstream tools.                         | Immediate: per-tool authorization, audit, and egress boundaries.              |
| `media`                        | Public   | Multi-service media stack; privileged VPN sidecar       | Privileged Gluetun shares namespace/storage with public media services; app is Progressing.        | Immediate: de-privilege/isolate VPN path and fix health.                      |
| `minecraft-allofcreate`        | LAN\*    | Stateful modded game server                             | Community mod supply chain and world recovery; routed WAN state is unverified.                     | Verify NAT, whitelist/authentication, and backups.                            |
| `minecraft-allthemons`         | LAN\*    | Stateful modded game server                             | Community mod supply chain and world recovery; routed WAN state is unverified.                     | Verify NAT, whitelist/authentication, and backups.                            |
| `minecraft-bettermc`           | LAN\*    | Stateful modded game server                             | Community mod supply chain and world recovery; routed WAN state is unverified.                     | Verify NAT, whitelist/authentication, and backups.                            |
| `minecraft-ftbskies2`          | LAN\*    | Stateful modded game server                             | Community mod supply chain and world recovery; routed WAN state is unverified.                     | Verify NAT, whitelist/authentication, and backups.                            |
| `minecraft-shuxin`             | Public   | Modded server with public map and UDP NodePort          | Public map, direct UDP exposure, and third-party plugins broaden attack surface.                   | Constrain map/UDP access and verify plugin provenance.                        |
| `minecraft-sjerred`            | Public   | Stateful modded server with public map                  | Public map discloses world state; plugin provenance and recovery need validation.                  | Review map privacy, plugins, and backups.                                     |
| `minecraft-stoneblock4`        | LAN\*    | Stateful modded game server                             | Community mod supply chain and world recovery; routed WAN state is unverified.                     | Verify NAT, whitelist/authentication, and backups.                            |
| `minecraft-tsmc`               | Public   | Stateful modded server with public map                  | Public map discloses world state; plugin provenance and recovery need validation.                  | Review map privacy, plugins, and backups.                                     |
| `nfd`                          | Internal | Node metadata discovery with host mounts                | Worker reads broad host filesystems and node metadata.                                             | Keep the exception narrow and monitor host access.                            |
| `openebs`                      | Internal | Host-privileged storage control plane                   | Privileged host networking and root/device mounts make compromise node- and data-wide.             | Immediate: isolate, pin, monitor, and test storage recovery.                  |
| `pinchtab`                     | Tailnet  | Remote browser-automation control plane                 | Browser/API access enables SSRF, internal pivoting, and session-data theft.                        | Immediate: strong auth, egress segmentation, disposable profiles.             |
| `plausible`                    | Public   | Public analytics app with two databases                 | Public ingestion can be abused; analytics and database recovery need validation.                   | Add rate limiting; review privacy and restore.                                |
| `pokemon`                      | Public   | Public bot/game UI                                      | Public input surface is currently Progressing.                                                     | Reconcile health, then review authentication and rate limits.                 |
| `postal`                       | Tailnet  | Mail control plane and credentialed relay               | Mail/API credentials and custom relay can enable spam or spoofing if compromised.                  | Restrict relay and egress; test recovery.                                     |
| `postal-mariadb`               | Internal | Stateful mail database                                  | Live database PVC is unlabeled and absent from the latest backup.                                  | Immediate: application-consistent backup and restore test.                    |
| `postgres-operator`            | Internal | Database lifecycle and Secret controller                | Operator creates and manages database credentials across its scope.                                | Restrict watched namespaces and RBAC.                                         |
| `prometheus`                   | Tailnet  | Monitoring control plane with host collectors           | Privileged disk/node collectors increase host impact; metrics PVC is unprotected.                  | Minimize collectors and document accepted telemetry loss.                     |
| `prometheus-adapter`           | Internal | Aggregated metrics API                                  | Bad metrics could affect workload admission or autoscaling.                                        | Monitor and retain narrow RBAC.                                               |
| `promtail`                     | Internal | Privileged host-log reader                              | Broad host log mounts do not include Kubernetes API audit logs.                                    | Immediate: reduce privilege and ship audit logs off-node.                     |
| `pyroscope`                    | Internal | Sensitive profiling store                               | Profiles can contain code/runtime data; live PVC lacks backup coverage.                            | Decide retention, access, and recovery.                                       |
| `redlib`                       | Tailnet  | Outbound content proxy                                  | Remote-fetch surface can cause privacy leakage or SSRF-style probing.                              | Constrain egress and keep tailnet-only.                                       |
| `relay`                        | Public   | Public WebSocket relay                                  | Long-lived connections need authentication, origin validation, quotas, and abuse controls.         | Validate all four controls.                                                   |
| `s3-static-sites`              | Public   | Static host and cross-namespace reverse proxy           | One public proxy bridges to application APIs and holds storage credentials.                        | Immediate: least-privilege buckets and explicit route/auth boundaries.        |
| `scout-beta`                   | Public   | Public secret-bearing application API                   | Non-production API adds authentication, rate-limit, and provider-spend surface.                    | Access-gate or enforce production-equivalent controls.                        |
| `scout-prod`                   | Public   | Public secret-bearing application API                   | Authentication/rate abuse can consume external quotas and expose user data.                        | Immediate: validate authorization and rate/spend limits.                      |
| `seaweedfs`                    | Tailnet  | Critical object and state storage                       | Critical PVCs are outside backup coverage and no full restore is proven.                           | Immediate: independent backups and end-to-end restore drill.                  |
| `starlight-karma-bot-beta`     | None     | Outbound Discord bot                                    | No distinct concern beyond bot-token scope and command authorization.                              | Preserve least-privilege bot permissions.                                     |
| `starlight-karma-bot-prod`     | None     | Outbound Discord bot                                    | No distinct concern beyond bot-token scope and command authorization.                              | Preserve least-privilege bot permissions.                                     |
| `syncthing`                    | Tailnet  | Bidirectional file synchronization                      | Compromise can propagate deletion, encryption, or exfiltration to peers.                           | Use versioning, independent backup, and strong UI/device auth.                |
| `tailscale`                    | Internal | Endpoint operator with broad Kubernetes RBAC            | Fleet is below security floor; operator manages networking and workload-adjacent resources.        | Immediate: upgrade fleet and reduce operator scope.                           |
| `tasknotes`                    | Tailnet  | Personal-data API                                       | Tailnet-only service still holds sensitive task data and credentials.                              | Review auth/session handling and test restore.                                |
| `tempo`                        | Internal | Trace store                                             | Traces can contain identifiers or Secrets; durable forensic recovery is not demonstrated.          | Set redaction, retention, and storage policy.                                 |
| `temporal`                     | Public   | Workflow/agent control plane with cross-namespace RBAC  | Public endpoints feed a worker with infrastructure credentials and selected exec rights.           | Immediate: split receivers and narrow worker identity by function.            |
| `temporal-redis`               | Internal | Unauthenticated ephemeral cache                         | Auth is off and ineffective NetworkPolicy permits lateral poisoning/disruption.                    | Authenticate or strictly isolate after enforcement.                           |
| `trmnl-dashboard`              | Public   | Dashboard with Kubernetes API identity                  | Degraded by missing configuration/Secret dependency; behavior is not trustworthy.                  | Reconcile immediately, then reassess auth and RBAC.                           |
| `turbo-cache`                  | Tailnet  | Credentialed build-cache service                        | Cache poisoning or credential theft can affect developer and CI builds.                            | Require strong client auth, object isolation, and integrity checks.           |
| `velero`                       | Internal | Cluster-admin backup controller                         | Restore path is untested and important PVCs/etcd lack demonstrated recovery.                       | Immediate: scope where possible and schedule restore drills.                  |

## Access gaps

The following surfaces require a later authenticated or disruptive review:

- Cloudflare account membership, MFA, Access applications, WAF custom/rate-limit rules, registrar
  lock, and R2 lifecycle/object-lock configuration; the available token returned forbidden for
  Access and registrar APIs.
- Router firmware, WAN administration, HTTPS configuration, port forwards, UPnP, WPS, IPv6
  firewalling, VLANs, and guest/IoT isolation; no router credentials or declared configuration were
  available.
- Firmware revision, TPM/IOMMU capability, physical console controls, and recovery-key custody.
- Buildkite organization membership, administrator roles, token inventory, and audit events.
- 1Password account recovery, vault membership, service-account scopes, event logging, and secret
  rotation age.
- Application user databases, plugin inventories, browser profiles, backup contents, and Secret
  values.
- Behavioral NetworkPolicy enforcement and an actual restore; both are intentionally mutating tests
  and were not authorized for this discovery phase.
- Direct node/LAN listener reachability from representative trusted, guest, and IoT networks.

## Release and advisory snapshot

This dated matrix records upstream release/advisory triage performed on 2026-07-19. It is not a
substitute for an SBOM-backed scan of every transitive library in every image. “No applicable
finding established” means the reviewed official source did not provide enough evidence for a
version-specific finding in this configuration; it does not mean no future or undisclosed issue
exists.

| Component             | Live version     | Official comparison                                                                                                                                                                                                  | Audit disposition                                                                                                     |
| --------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Kubernetes            | 1.36.2           | [1.36.2 was the current release](https://github.com/kubernetes/kubernetes/releases/tag/v1.36.2); the [security disclosure index](https://kubernetes.io/docs/reference/issues-security/security/) was reviewed.       | Current; no applicable version-specific finding established.                                                          |
| Talos/Linux           | 1.13.6 / 6.18.38 | [Talos 1.13.6 was current](https://github.com/siderolabs/talos/releases/tag/v1.13.6); [CVE-2026-31431](https://www.cve.org/CVERecord?id=CVE-2026-31431) lists this kernel line/version beyond the affected boundary. | Current and not affected by that reviewed container-pivot advisory.                                                   |
| Flannel               | 0.28.5           | [Flannel 0.28.7 was current](https://github.com/flannel-io/flannel/releases/tag/v0.28.7).                                                                                                                            | Two patch releases behind; no specific exploitable advisory established, but update with the policy-enforcement work. |
| Argo CD               | 3.4.5            | [Argo CD 3.4.5 was current](https://github.com/argoproj/argo-cd/releases/tag/v3.4.5) and publishes signed images/SLSA provenance.                                                                                    | Current; configuration and trust-boundary findings remain.                                                            |
| OpenEBS / LocalPV ZFS | 4.5.1 / 2.10.1   | [OpenEBS 4.5.1 was current](https://github.com/openebs/openebs/releases/tag/v4.5.1).                                                                                                                                 | Current; no distinct advisory established for the enabled ZFS path. Privilege and recovery remain material.           |
| Velero                | 1.18.1           | [Velero 1.18.1 release](https://github.com/velero-io/velero/releases/tag/v1.18.1) and version-pinned 1.18 recovery guidance were reviewed.                                                                           | No applicable version-specific finding established; restore assurance is the finding.                                 |
| cert-manager          | 1.21.0           | [cert-manager 1.21.0 was current](https://github.com/cert-manager/cert-manager/releases/tag/v1.21.0).                                                                                                                | Current, but the live Application was OutOfSync at the timestamped snapshot.                                          |
| Kyverno               | 1.18.1           | [Kyverno 1.18.1 release](https://github.com/kyverno/kyverno/releases/tag/v1.18.1) was reviewed.                                                                                                                      | No applicable version-specific finding established; narrow enforce-mode coverage is the finding.                      |
| Tailscale             | 1.90.6–1.98.8    | [Security bulletins](https://tailscale.com/security-bulletins) set 1.98.9 as the fixed floor for feature-specific issues.                                                                                            | Patch immediately, prioritizing Serve/operator proxies and SSH-enabled devices.                                       |
| cloudflared           | 2025.4.0         | [2026.7.2 was current](https://github.com/cloudflare/cloudflared/releases/tag/2026.7.2); Cloudflare supports releases within one year of current.                                                                    | Outside support window and drifted from declared state.                                                               |
| Promtail              | deployed         | [Promtail reached end of life on 2026-03-02](https://grafana.com/docs/loki/latest/send-data/promtail/).                                                                                                              | Migrate to a dedicated, nonprivileged Alloy log collector.                                                            |

## Sanitized evidence appendix

Run these commands only with the existing read-only/admin context and retain raw outputs outside the
public repository. None of these commands requests Secret payloads.

```bash
# Platform and health
kubectl version
kubectl get --raw='/readyz?verbose'
talosctl version
talosctl health
talosctl get securitystate
talosctl get volumeconfig,volumestatus

# Admission, network, and workload posture
kubectl get namespaces --show-labels
kubectl get networkpolicy --all-namespaces
kubectl -n kube-system get daemonset kube-flannel -o yaml
kubectl get validatingadmissionpolicy,clusterpolicy,policyreport --all-namespaces
kubectl get deployment,statefulset,daemonset,job,cronjob --all-namespaces -o json
kubectl get role,rolebinding,clusterrole,clusterrolebinding --all-namespaces -o json

# GitOps, storage, and recovery metadata
argocd app list -o json
kubectl get pvc --all-namespaces --show-labels
velero backup get
velero restore get
velero schedule get
velero backup-location get

# Local Tailscale posture (sanitize device/user details before retention)
tailscale status --json
tailscale serve status --json
```

For a service account under review, use server-side authorization checks instead of attempting the
action:

```bash
kubectl auth can-i get secrets \
  --as=system:serviceaccount:NAMESPACE:SERVICE_ACCOUNT \
  --namespace=TARGET_NAMESPACE
kubectl auth can-i create jobs.batch \
  --as=system:serviceaccount:NAMESPACE:SERVICE_ACCOUNT \
  --namespace=TARGET_NAMESPACE
```

Public HTTP checks were limited to one or a few ordinary requests per route. They established route,
TLS, redirect, and authentication behavior only; they did not test authorization depth or
application vulnerabilities.

## Authoritative references

- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
  and [Flannel network-policy guidance](https://github.com/flannel-io/flannel/blob/master/Documentation/netpol.md)
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/),
  [RBAC good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/),
  [Auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/), and
  [encryption at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Talos SecureBoot](https://docs.siderolabs.com/talos/v1.13/platform-specific-installations/bare-metal-platforms/secureboot),
  [disk encryption](https://docs.siderolabs.com/talos/v1.13/configure-your-talos-cluster/storage-and-disk-management/disk-encryption),
  [Ingress Firewall](https://docs.siderolabs.com/talos/v1.13/networking/ingress-firewall),
  [SELinux](https://docs.siderolabs.com/talos/v1.13/security/selinux),
  [Talos 1.13.6](https://github.com/siderolabs/talos/releases/tag/v1.13.6), and
  [CVE-2026-31431](https://www.cve.org/CVERecord?id=CVE-2026-31431)
- [Tailscale security bulletins](https://tailscale.com/security-bulletins),
  [policy syntax](https://tailscale.com/docs/reference/syntax/policy-file), and
  [Tailnet Lock](https://tailscale.com/docs/features/tailnet-lock), plus
  [key expiry](https://tailscale.com/docs/features/access-control/key-expiry)
- [Argo CD user management](https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/),
  [AppProjects](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/),
  [automated sync](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/), and
  [Argo CD security](https://argo-cd.readthedocs.io/en/stable/operator-manual/security/)
- [Cloudflare Tunnel downloads and support](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/),
  [self-hosted Access applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
  and
  [origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)
- [Third-party Cloudflare operator](https://github.com/adyanth/cloudflare-operator)
- [1Password operator documentation](https://www.1password.dev/k8s/operator) and the official
  [Connect chart ClusterRole](https://github.com/1Password/connect-helm-charts/blob/main/charts/connect/templates/clusterrole.yaml)
- [Home Assistant reverse-proxy configuration](https://www.home-assistant.io/integrations/http/)
- [Grafana Alloy access permissions](https://grafana.com/docs/alloy/latest/access_permissions/kubernetes/)
  and [eBPF component requirements](https://grafana.com/docs/alloy/latest/reference/components/pyroscope/pyroscope.ebpf/)
- [Promtail end-of-life notice](https://grafana.com/docs/loki/latest/send-data/promtail/) and
  [Loki filesystem durability limitations](https://grafana.com/docs/loki/latest/operations/storage/filesystem/)
- [Tailscale Kubernetes operator RBAC](https://tailscale.com/docs/kubernetes-operator/reference/rbac)
  and [ProxyClass](https://tailscale.com/docs/kubernetes-operator/concepts/proxyclass)
- [Helm provenance and integrity](https://helm.sh/docs/topics/provenance/),
  [Sigstore Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/),
  [Kyverno image verification](https://kyverno.io/docs/policy-types/cluster-policy/verify-images/overview/),
  and [SLSA artifact verification](https://slsa.dev/spec/v1.2/verifying-artifacts)
- [Velero manual testing](https://velero.io/docs/v1.18/manual-testing/),
  [Velero disaster recovery](https://velero.io/docs/v1.18/disaster-case/),
  [PostgreSQL 17 continuous archiving and PITR](https://www.postgresql.org/docs/17/continuous-archiving.html),
  [R2 Bucket Locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/), and
  [R2 Object Lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Buildkite security controls](https://buildkite.com/docs/pipelines/best-practices/security-controls),
  [self-hosted agent security](https://buildkite.com/docs/agent/self-hosted/security),
  [Buildkite Secrets](https://buildkite.com/docs/pipelines/security/secrets/buildkite-secrets), and
  [Agent Stack for Kubernetes](https://buildkite.com/docs/agent/self-hosted/agent-stack-k8s/running-builds)
- [MITRE ATT&CK for Containers](https://attack.mitre.org/matrices/enterprise/containers/)
  and [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)

## Session Log — 2026-07-19

### Done

- Completed read-only repository and live-state assessment across Kubernetes, Talos, Linux kernel,
  workloads, RBAC, admission, networking, Tailscale, Cloudflare, GitOps, Buildkite, supply chain,
  storage, backup, and detection surfaces.
- Researched current official guidance and security advisories for the deployed control-plane,
  network, edge, CI, GitOps, and recovery technologies.
- Reconciled declared and live behavior, including the unenforced NetworkPolicies, active Tailscale
  ACL, dormant Dagger objects, Argo authentication behavior, Talos boot state, and Velero coverage.
- Completed an independent adversarial pass that reduced unsupported severities, corrected
  conditional claims, added the 1Password controller finding, and approved the revised report.
- Reconciled the exact 66-application coverage matrix, added the dated release/advisory matrix, and
  completed the prioritized findings, remediation roadmap, verification criteria, access gaps, and
  sanitized evidence appendix.
- Rendered, opened, and visually inspected the six-page executive Typst/PDF report; verified every
  report URL returned HTTP 200 and Markdown lint passed.
- Recorded the owner's repository-retention approval, tracked the reproducible Typst source and
  rendered PDF beside this decision, and backed up the audit feature branch to `origin`.

### Remaining

- No audit-delivery or repository-retention work remains. Live remediation is a separate, mutating
  phase that has not started.
- No pull request or merge into `main` was requested or performed.

### Caveats

- No live remediation, exploit, restore, router login, Secret-value inspection, or application-data
  inspection was authorized or performed.
- Findings involving physical access, LAN segmentation, Cloudflare account controls, and application
  user/plugin state remain conditional on the documented access gaps.
- The repository-retention approval applies to these sanitized artifacts only; Secret values,
  actionable exploit procedures, and sensitive topology remain intentionally excluded.
