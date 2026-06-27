# Homelab Auth Strategy — Discussion

## Status

Complete (advisory; no code changes)

## Question

> How do people do auth for homelabs? ATM I have a ton of services.

## Current state (from exploration of `packages/homelab/`)

- **Network boundary:** Tailscale ingress (`src/cdk8s/src/misc/tailscale.ts`) for ~30+ internal
  services via MagicDNS (`tailnet-1a49.ts.net`). This is the primary auth layer.
- **Public exposure:** Cloudflare Tunnel (`src/cdk8s/src/misc/cloudflare-tunnel.ts`) for
  `*.sjer.red` (Home Assistant, Overseerr/Seerr, Freshrss, Plausible, etc.) — **no auth layer
  beyond each app's own login.** This is the main gap.
- **Static sites:** Caddy + s3proxy (public, intentionally open).
- **No centralized SSO** — no Authelia/Authentik/Keycloak/oauth2-proxy/forward-auth.
- **Per-service auth** is ad hoc: PinchTab bearer token, MCP gateway token, Birmel GitHub OAuth,
  Scout Discord OAuth, ChartMuseum basic auth.
- **Tailscale ACLs are flat** — any tailnet device reaches every internal service. The 2026-06-06
  pen-test remediation plan flagged "tailnet ACLs pending"; still open.
- No Traefik/nginx ingress controller exists (so a self-hosted forward-auth portal would mean
  adding a new reverse-proxy layer).

## Landscape summarized for the user

VPN/network-level (Tailscale — already done) → cloud identity-aware proxy (Cloudflare Access) →
self-hosted forward-auth SSO (Authentik/Authelia/Pocket-ID/tinyauth) → native OIDC per-app →
per-app auth (the thing to escape). Community favorites noted: Authentik (heavy), Authelia
(light), Pocket-ID (passkey-only, rising), and the "minimal-ops" Tailscale + Cloudflare Access
combo.

## Recommendation given the stack (Talos/cdk8s/ArgoCD/CF-via-Tofu/Tailscale/1Password)

1. **Cloudflare Access** in front of the tunnel — free, no app changes, codify as Terraform in
   `src/tofu/cloudflare/` (`cloudflare_zero_trust_access_application`/`_policy`). Closes the
   public hole. Highest priority.
2. **Tighten Tailscale ACLs/grants** — segment the flat tailnet (the pending pen-test item).
3. **Only then** a single OIDC provider (Pocket-ID or Authentik) wired natively into OIDC-capable
   apps (Grafana, Overseerr, \*arr via plugins); forward-auth only for apps with no auth.
   Avoid jumping straight to "Authentik + Traefik forward-auth for everything" — redundant for a
   Tailscale-first lab.

## Follow-up: security-boundary concern (public apps with a vuln)

User clarified the real concern: ~10-20 internet-exposed apps each rely on their **own login** as the
only boundary. Worry = a pre-auth vuln in any one of them. Reframed the answer around two axes.

### Principle

An app's own login IS attack surface, not a boundary. Most mass-exploitation is pre-auth. Put an
**independent hardened auth layer in front** so unauth attackers never reach the app's code. Then:
(1) shrink the unauthenticated surface, (2) contain the breach of whatever stays open.

### Half 1 — reduce surface (triage the public apps)

- **Bucket A — not public at all** (you/family only → Tailscale-only): Home Assistant, Freshrss,
  Z-Wave UI, Scrypted, all \*arr admin UIs (Sonarr/Radarr/Prowlarr/Bazarr/qBittorrent), Plex/Jellyfin
  admin. HA is the standout — runs `hostNetwork: true` (bypasses NetworkPolicy), pre-auth CVE history,
  controls the house; should not be nakedly public.
- **Bucket B — known people, no VPN** (Cloudflare Access in front): Overseerr/Seerr, Grafana.
- **Bucket C — genuinely public** (can't hide behind auth): Pokemon/Mario-Kart streams, Minecraft,
  Plausible ingest beacon, Birmel OAuth callback, real websites → DMZ treatment + WAF.

Triage likely cuts "10-20 public" to ~3-5 truly-public. CF tunnel is already outbound-only (no inbound
port to scan); Access is the identity gate on top.

### Half 2 — reduce blast radius (audit findings, RE-CONFIRM before acting)

Quick audit of `packages/homelab/` "assume breach" posture — a popped public pod is currently NOT
contained:

- **No default-deny egress.** `media` namespace has zero egress policy; a popped pod can reach ArgoCD
  (≈cluster-admin), 1Password operator, DBs, kube-apiserver, internet (C2/exfil).
  (`src/cdk8s/src/cdk8s-charts/media.ts`, `home.ts`.)
- **SA tokens auto-mount** on public pods (K8s API enumeration); only a few set
  `automountServiceAccountToken` explicitly.
- **Kyverno installed but only does the Velero backup mutation** — enforces zero pod security
  (`src/cdk8s/src/resources/kyverno-policies.ts`).
- **No Pod Security `restricted`** on public namespaces (`apps.ts` labels only infra).
- Tailscale subnet-router bridge: NOT found (good — tailnet not reachable from a popped pod).

Hardening priority: (1) default-deny egress NetworkPolicy on public namespaces (deny pod→apiserver,
ArgoCD, 1Password, tailnet); (2) `automountServiceAccountToken: false` on public pods; (3) enforce PSS
`restricted` via the already-running Kyverno (also disallow hostNetwork/hostPath, restrict registries);
(4) Cloudflare WAF/rate-limit on bucket-C; (5) Renovate auto-merge for public image security patches.

Caveat: subagent's "popped pod → 1Password Connect → secrets" path is speculative (Connect needs a
token); the solid lateral risks are SA-token→API (RBAC-dependent), reaching ArgoCD, and cross-namespace
DB access + unrestricted egress.

## Offered follow-ups (not yet started — awaiting user pick)

- **(a)** cdk8s "public-app hardening" helper: default-deny egress + `automountServiceAccountToken:
false` + restricted pod-security, applied to `media`/`home` first. (Recommended first PR — durable
  boundary.)
- **(b)** Triage: flip you-only apps off the CF tunnel onto Tailscale-only.
- **(c)** Cloudflare Access Tofu for the shared apps (`src/tofu/cloudflare/`,
  `cloudflare_zero_trust_access_application`/`_policy`).
- Segmented Tailscale ACL policy (the pending pen-test item — in-cluster egress hardening is its
  complement).

## Session Log — 2026-06-25

### Done

- Mapped existing homelab auth/ingress/exposure model (Tailscale ingress, CF tunnel, Caddy/S3,
  per-service tokens; no SSO; flat tailnet ACLs).
- Answered the landscape question and gave a prioritized, stack-specific recommendation.
- On follow-up, audited the "assume breach" / blast-radius posture and reframed around surface
  reduction (triage) + breach containment (default-deny egress, no SA token, Kyverno PSS).

### Remaining

- No code/infra started — awaiting user pick among follow-ups (a)/(b)/(c) above. Will use a worktree.

### Caveats

- Advisory only; no code or infra changed.
- Half-2 audit findings came from a subagent sweep — **re-confirm against the live tree** before
  acting (esp. exact NetworkPolicy/egress state per namespace and the 1Password lateral-movement path).
- "tailnet ACLs pending" cross-checked against memory (`project_homelab_security_hardening.md`);
  confirm it's still unresolved before treating ACL work as net-new.
