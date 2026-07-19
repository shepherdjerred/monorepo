#let navy = rgb("#11263d")
#let blue = rgb("#246b8e")
#let teal = rgb("#16847a")
#let green = rgb("#2c7a5b")
#let amber = rgb("#c77800")
#let red = rgb("#b63a3a")
#let ink = rgb("#1c2733")
#let muted = rgb("#647180")
#let border = rgb("#d9e1e8")
#let paper = rgb("#f5f7f9")

#set page(
  paper: "us-letter",
  margin: (x: 0.72in, top: 0.68in, bottom: 0.65in),
  header: context [
    #set text(size: 7.5pt, fill: muted)
    #if counter(page).get().first() > 1 [
      *TORVALDS HOMELAB* #h(1fr) INFRASTRUCTURE SECURITY AUDIT
      #line(length: 100%, stroke: 0.5pt + border)
    ]
  ],
  footer: context [
    #set text(size: 7.5pt, fill: muted)
    #line(length: 100%, stroke: 0.5pt + border)
    #v(4pt)
    Read-only assessment · 19 July 2026 #h(1fr)
    #counter(page).display("1")
  ],
)
#set text(font: "New Computer Modern", size: 9.2pt, fill: ink)
#set par(justify: true, leading: 0.58em)
#set heading(numbering: none)
#show heading.where(level: 1): set text(size: 22pt, weight: "bold", fill: navy)
#show heading.where(level: 2): set text(size: 14pt, weight: "bold", fill: navy)
#show heading.where(level: 3): set text(size: 10.5pt, weight: "bold", fill: blue)
#show link: set text(fill: blue)

#let pill(body, color: blue) = box(
  fill: color.lighten(84%),
  stroke: 0.6pt + color.lighten(45%),
  radius: 10pt,
  inset: (x: 8pt, y: 3pt),
  text(size: 7.5pt, weight: "bold", fill: color, body),
)

#let stat(value, label, color: blue) = block(
  width: 100%,
  fill: paper,
  stroke: 0.6pt + border,
  radius: 5pt,
  inset: 10pt,
  [
    #text(size: 20pt, weight: "bold", fill: color)[#value]
    #v(1pt)
    #text(size: 7.5pt, fill: muted)[#label]
  ],
)

#let callout(title, body, color: blue) = block(
  width: 100%,
  fill: color.lighten(91%),
  stroke: (left: 3pt + color),
  radius: 3pt,
  inset: (left: 12pt, right: 11pt, y: 9pt),
  [
    #text(weight: "bold", fill: color)[#title]
    #v(3pt)
    #body
  ],
)

#let finding(id, title, body, color: red) = block(
  breakable: false,
  width: 100%,
  stroke: 0.6pt + border,
  radius: 4pt,
  inset: 9pt,
  [
    #pill(id, color: color) #h(5pt) #text(weight: "bold", fill: navy)[#title]
    #v(4pt)
    #text(size: 8.4pt)[#body]
  ],
)

#align(center)[
  #v(0.42in)
  #pill([READ-ONLY SECURITY ASSESSMENT], color: teal)
  #v(0.26in)
  #text(size: 34pt, weight: "bold", fill: navy)[Infrastructure]
  #v(1pt)
  #text(size: 34pt, weight: "bold", fill: navy)[Security Audit]
  #v(0.15in)
  #text(size: 14pt, fill: blue)[Kubernetes · Talos · Tailscale · Cloudflare · Workloads]
  #v(0.33in)
  #line(length: 1.25in, stroke: 2pt + teal)
  #v(0.3in)
  #text(size: 11pt, fill: muted)[Torvalds homelab · 19 July 2026]
]

#v(0.55in)

#callout(
  [Executive verdict],
  [
    The environment has a credible security foundation, but several deployed controls provide
    less protection than their configuration suggests. The clearest example is network
    isolation: 49 NetworkPolicy objects exist, yet no live controller enforces them.

    No Critical finding, active compromise, authentication bypass, or unauthenticated
    Internet-to-node path was confirmed. Seven High findings do create realistic paths from a
    compromised public workload, same-repo CI job, or trusted controller to cluster or node
    control. Short-lived local audit logs and untested recovery would magnify the impact.
  ],
  color: navy,
)

#v(0.3in)

#grid(
  columns: (1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
  gutter: 6pt,
  stat([0], [Critical], color: green),
  stat([7], [High], color: red),
  stat([14], [Medium], color: amber),
  stat([4], [Low], color: teal),
  stat([66], [Argo apps], color: blue),
  stat([49], [Policy objects], color: blue),
)

#v(0.3in)

#align(center)[
  #text(size: 8pt, fill: muted)[
    Source of truth: repository decision record. Raw exploit procedures and sensitive topology
    are deliberately excluded from this public-safe rendering.
  ]
]

#pagebreak()

= The decisions that matter now

#v(2pt)

The first wave is about restoring *real boundaries*: enforce declared isolation, separate build
execution from cluster control, patch the tailnet, and preserve evidence and recovery options.

#v(8pt)

#table(
  columns: (0.35fr, 1.5fr, 2.3fr, 0.75fr),
  inset: (x: 6pt, y: 6pt),
  stroke: 0.5pt + border,
  fill: (x, y) => if y == 0 { navy } else if calc.even(y) { paper } else { white },
  align: (left, left, left, center),
  table.header(
    text(fill: white, weight: "bold")[No.],
    text(fill: white, weight: "bold")[Action],
    text(fill: white, weight: "bold")[Why now],
    text(fill: white, weight: "bold")[Risk],
  ),
  [1], [Enforce NetworkPolicy], [Existing policies have no effect without a controller.], [High],
  [2], [Split Buildkite identities], [Job pods currently inherit controller RBAC in a privileged namespace.], [Medium],
  [3], [Patch Tailscale], [Every device is below 1.98.9; bulletin exposure depends on enabled features.], [Low],
  [4], [Reduce crown-jewel RBAC], [1Password, Alloy, Cloudflare operator, and SeaweedFS carry broad cluster authority.], [Medium],
  [5], [Protect Argo and receivers], [Public request handling terminates near cluster-wide credentials.], [Medium],
  [6], [Export audit logs and restore], [About 3.6 hours of local evidence and zero observed Restore objects are inadequate.], [Medium],
)

#v(14pt)

== Strong controls worth preserving

#grid(
  columns: (1fr, 1fr),
  gutter: 9pt,
  callout([Host and control plane], [
    Talos immutable host; unified kernel image; module signatures; hardened eBPF/ptrace; seccomp
    default; API anonymous auth off; Secret encryption at rest; audit Metadata enabled.
  ], color: green),
  callout([Identity and edge], [
    Tailscale deny-by-omission policy with tests; no Funnel or subnet routes; Cloudflare strict TLS
    on most zones; DNSSEC active on nine of ten zones.
  ], color: green),
  callout([Build and artifacts], [
    Fork PR builds disabled; repository secret scanning and push protection enabled; blocking
    Gitleaks; many first-party images pinned by digest.
  ], color: green),
  callout([Backup signal], [
    Four Velero schedules; 26 retained Backup objects completed; latest run completed all 42
    attempted snapshots. This is backup evidence, not restore evidence.
  ], color: green),
)

#pagebreak()

= Confirmed High findings

#text(size: 8pt, fill: muted)[
  “Design risk” means a real, high-impact trust path exists even though no current bypass or
  compromise was demonstrated.
]

#v(7pt)

#grid(
  columns: (1fr, 1fr),
  gutter: 8pt,
  finding([F-02], [CI reaches cluster control], [
    Branch-controlled Buildkite jobs receive broad Secrets, mount the controller identity, and can
    create Jobs where privileged workloads are permitted. Fork builds are disabled.
  ]),
  finding([F-03], [Unsigned GitOps trust], [
    An authenticated chart publisher can feed moving, unsigned artifacts into automated sync;
    wildcard AppProjects permit privileged and cluster-scoped resources.
  ]),
  finding([F-05], [Cloudflare operator authority], [
    A third-party alpha controller can read and write every cluster Secret and mutate workloads.
    Its image is tag-only and its authority is not limited to tunnel resources.
  ]),
  finding([F-08], [Public receivers share credentials], [
    Three authenticated public routes terminate in a Temporal worker holding numerous
    infrastructure credentials and selected exec rights. Authentication tested fail-closed.
  ]),
  finding([F-09], [SeaweedFS escalation], [
    The storage identity can create Pods cluster-wide while infrastructure namespaces permit
    privileged workloads. No misuse or active compromise was demonstrated.
  ]),
  finding([F-10], [Recovery is unproven], [
    Zero Restore objects, 20 unlabeled PVCs, inconsistent database coverage, no automated etcd
    snapshot or restore evidence, and no observed consistency hooks leave RPO/RTO unknown.
  ]),
  finding([F-12], [1Password controller authority], [
    The operator can mutate cluster-wide Secrets, namespaces, Pods, and application controllers
    while Connect holds access to synchronized vault items.
  ]),
)

#pagebreak()

= How the risk compounds

The major issue is not one exposed service. It is the combination of reachable parsing surfaces,
high-trust identities, unenforced segmentation, and weak post-incident evidence.

#v(12pt)

#grid(
  columns: (1fr, 20pt, 1fr, 20pt, 1fr),
  align: center,
  callout([Initial foothold], [
    Same-repo CI execution\\
    Public receiver flaw\\
    Controller or artifact compromise\\
    Lost admin endpoint
  ], color: amber),
  text(size: 18pt, fill: muted)[→],
  callout([Boundary failure], [
    Shared controller token\\
    NetworkPolicy not enforced\\
    Cluster-wide Secret RBAC\\
    Wildcard GitOps project
  ], color: red),
  text(size: 18pt, fill: muted)[→],
  callout([Impact], [
    Node-level workload\\
    Credential collection\\
    Cross-namespace movement\\
    Destructive cluster change
  ], color: red),
)

#v(16pt)

#grid(
  columns: (1fr, 20pt, 1fr),
  align: center,
  callout([Incident occurs], [
    Local node and workload state changes faster than current evidence retention.
  ], color: red),
  text(size: 18pt, fill: muted)[→],
  callout([Recovery uncertainty], [
    Short audit history, local Loki, incomplete data classification, and no isolated restore proof.
  ], color: amber),
)

#v(18pt)

== Medium-risk themes

#table(
  columns: (1.05fr, 2.4fr),
  inset: (x: 7pt, y: 6pt),
  stroke: 0.5pt + border,
  fill: (x, y) => if y == 0 { navy } else if calc.even(y) { paper } else { white },
  table.header(
    text(fill: white, weight: "bold")[Theme],
    text(fill: white, weight: "bold")[Observed posture],
  ),
  [Network isolation], [Flannel lacks a separate policy controller; 49 NetworkPolicy objects are ineffective until enforcement is installed and behaviorally tested.],
  [Boot and physical], [Secure Boot and disk encryption off; SELinux permissive; lockdown integrity is an intentional eBPF trade-off.],
  [LAN and host], [Control-plane listeners bind broadly; no Talos ingress firewall; router administration needs authenticated review.],
  [Admission], [Baseline enforcement is active; restricted is advisory, privileged exceptions exist, and custom API-boundary policy is narrow.],
  [Artifact trust], [Many tag-only images; no required SBOM, signature, provenance, or admission-verification chain.],
  [Edge patching], [Tailscale is below the feature-specific bulletin floor; cloudflared is unsupported and drifted from declared state.],
  [Admin surface], [Internet requests reach Argo's authenticated local-admin login; no bypass was found and default rate limiting appears active.],
  [Observability trust], [Alloy combines intended node privilege with unnecessary all-Secret reads; audit logs remain short-lived and node-local.],
  [Application pivots], [Broad HA proxy trust, shared Tailscale proxy Secrets, and unsandboxed PinchTab need containment.],
  [Availability], [Single node, no quotas, incomplete limits, and persistent GitOps drift couple outages to security response.],
  [Detection], [No workload-aware runtime sensor; event export is ineffective; paging is single-person and fatigue-prone.],
)

#pagebreak()

= Remediation sequence

== 0–72 hours — reduce immediate exposure

- Upgrade all Tailscale clients, prioritizing administrator and SSH endpoints.
- Split Buildkite controller and job service accounts; remove job RBAC and token mounting.
- Remove or isolate Alloy Secret access, SeaweedFS Pod authority, and 1Password's cluster-wide
  workload scope.
- Put Argo behind Access or the tailnet, establish SSO, and retire routine built-in admin use.
- Deploy a supported digest-pinned cloudflared release and reconcile source/live drift.
- Preserve current audit logs and backup metadata; do not delete orphan-looking snapshot objects.

== Within 7 days — create real boundaries

- Install and behaviorally validate a NetworkPolicy enforcer, one namespace at a time.
- Split public Temporal receivers from privileged workers and credentials.
- Replace or sharply scope the Cloudflare operator.
- Ship Kubernetes audit logs to independently protected off-node storage.
- Disable/authenticate filer S3; correct Home Assistant proxy trust.
- Explicitly classify all 66 PVCs as protected or intentionally disposable.

== Within 30 days — prove trust and recovery

- Run isolated etcd, Talos, and database-backed application restore drills.
- Create least-privilege AppProjects; pin and sign chart artifacts.
- Generate SBOM/provenance, sign images, and enforce verification for privileged workloads first.
- Roll out workload-class admission policies and service-account-token defaults.
- Segment PinchTab and Tailscale proxy identities; remove dormant Dagger resources.
- Establish high-value runtime/event detection and an owned incident triage path.

#v(10pt)

#callout([Sequence dependency], [
  Network enforcement has the highest outage risk because existing policy objects have never been
  exercised. Observe traffic, stage by namespace, test both allowed and denied paths, and keep an
  explicit rollback. Restore evidence should be captured before broad policy and identity changes.
], color: amber)

#pagebreak()

= Scope, assurance, and open evidence

== What was verified

- Repository intent and live Kubernetes/Talos/Argo/Tailscale/Cloudflare metadata were reconciled.
- All 66 Argo Applications and 166 long-running workload controllers were inventoried at the
  timestamped snapshot.
- Workload security context, RBAC, service-account, exposure, image, storage, backup, and admission
  posture were aggregated with targeted application reviews.
- Low-impact route, TLS, redirect, and authentication checks were performed. No exploit was
  attempted.
- Read-only checks generated ordinary access/audit logs and may have incremented authentication or
  rate-limit counters; no stored configuration or workload state was intentionally changed.
- Official current guidance and advisories were checked for the core control-plane, edge, CI,
  GitOps, supply-chain, and recovery technologies.

== What remains an access gap

- Cloudflare account membership/MFA, dashboard Access/WAF/rate-limit rules, registrar lock, and R2
  retention controls.
- Router firmware, WAN administration, HTTPS, port forwards, UPnP/WPS, IPv6 firewall, and network
  segmentation.
- TPM/IOMMU capability, physical console protection, firmware revision, and recovery-key custody.
- Buildkite organization membership/roles/audit; 1Password membership/scopes/recovery/events.
- Application databases, plugin inventories, browser profiles, backup contents, and Secret values.
- Behavioral NetworkPolicy tests, a real restore, and representative LAN reachability.

#v(12pt)

#callout([Evidence standard], [
  “Confirmed” means live state or two corroborating signals supported the claim. “Design risk”
  means the privilege and path are real, but no bypass or compromise was demonstrated. Missing
  access is recorded as an access gap, never assumed absent.
], color: teal)

#v(12pt)

== Bottom line

The homelab is not in an emergency state. Its immediate security work is nevertheless concrete:
some declared boundaries are not real, and several trusted components carry more authority than
their role requires. Fixing enforcement and identity separation first will reduce the value of a
single application compromise. Durable evidence and tested recovery then turn a severe incident
from an uncertain rebuild into a controlled operation.

#v(14pt)

#align(center)[
  #pill([NEXT: REMEDIATION WAVE 1], color: teal)
  #v(6pt)
  #text(size: 8pt, fill: muted)[
    Network-policy enforcer · Buildkite identity split · Tailscale patching · crown-jewel RBAC
  ]
]
