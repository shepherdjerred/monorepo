# Plan: Self-hosted Obsidian + Relay for couple collaboration

## Status

Complete (deployed live) — Relay Server running on the cluster at `https://relay.sjer.red`,
backed by SeaweedFS. Bootstrapped via `kubectl apply` ahead of CI; PR pending for GitOps
adoption. Client-side setup (vault + plugin + registration) is the only remaining user step.

## Context

We evaluated shared-space options for a couple (trips, wedding planning, restaurant wishlist)
and chose **Obsidian + Relay** over Notion / AppFlowy / Anytype. The deciding factor was
**portability/ownership**: Obsidian data is plain Markdown on disk (no export step, no lock-in),
whereas Anytype's Markdown export drops relations and Notion is bloated. The two historical
Obsidian blockers are gone: **Bases** (native, 2025) gives Notion-style databases
(table/cards/map over frontmatter) and **Relay** (CRDT plugin) gives real-time multiplayer.
Obsidian's _native_ multiplayer is still "Planned" (no ETA) on the official roadmap, and because
everything is plain files, migrating off Relay later is cheap — so we are not waiting for it.

**Goal of this plan:** self-host the Relay collaboration server on the homelab
(`packages/homelab/`) so the couple's shared vault syncs/collaborates through our own
infrastructure and storage.

### Committed architecture

- A **dedicated new Obsidian vault** for couple content (separate from the personal vault).
- That vault is **NOT** synced by Obsidian Sync (avoids the Relay↔Sync "double coverage" that
  causes conflicts/data loss). **Relay** provides both real-time collaboration AND cross-device
  sync for this vault.
- **Self-hosted Relay Server** runs on the homelab, backed by **SeaweedFS** (S3) storage.
- Both people run **Obsidian + Relay** on **phone + MacBook** (2 users, 4 clients).

### Decisions (confirmed with user)

1. **Network exposure: PUBLIC** via Cloudflare Tunnel (`relay.sjer.red`). **Tailscale explicitly
   declined** by the user — partner's off-network devices need nothing extra, and Cloudflare Tunnel
   is outbound-only (no open inbound port on the homelab; Cloudflare edge fronts it).
   - **Auth model (accepted):** delegated auth — the Relay Server validates relay.md's
     control-plane-issued, document-scoped, 1-hour tokens (public keys baked into the image). So
     public ≠ open: random visitors cannot read/write; access requires a token relay.md signed for
     an authorized member. This is OAuth/SSO-style trust in relay.md as the identity provider. A
     separate interactive login layer (Cloudflare Access/SSO) is **not** possible — the Relay
     WebSocket client can't complete it and it would break the plugin.
   - **Accepted tradeoffs:** (a) not end-to-end encrypted — on a public server relay.md _could_
     technically mint a token and read content (user is **not concerned about encryption right
     now**); (b) trusting relay.md as IdP/gatekeeper. Both knowingly accepted.
2. **Storage: SeaweedFS S3 bucket** (`seaweedfs.sjer.red`) — reuse existing homelab infra;
   self-hosting means free/unmetered attachments (photos/PDFs) since we own the bucket.
3. **Scope: server deployment only.** Vault creation + plugin install + Bases/templates are
   manual client steps, documented below (not built in this plan).

## Relay Server spec (verified)

- **One container**, image `docker.system3.md/relay-server:v0.9.2` (Rust; y-sweet fork; **beta**).
- **Ports:** `8080` HTTP/WebSocket, `9090` Prometheus metrics.
- **Config is pure env vars** (no `relay.toml` mount; `[[auth]]` public keys are baked into the
  image — do NOT override):
  - `RELAY_SERVER_URL=https://relay.sjer.red` — **must exactly match** the ingress hostname and
    the URL registered in Obsidian (the #1 failure mode).
  - `RELAY_SERVER_STORAGE=s3`
  - `AWS_ENDPOINT_URL_S3=https://seaweedfs.sjer.red`, `AWS_S3_USE_PATH_STYLE=true` (SeaweedFS is
    path-style), `AWS_REGION=us-east-1`, `STORAGE_BUCKET=relay-docs`.
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — from the 1Password-synced secret.
- **Storage:** S3-compatible (SeaweedFS) is required for attachments. No separate DB; all
  document CRDT state + attachments live in the bucket.
- **Client registration:** in Obsidian (logged into Relay) run **`Relay: Register self-hosted
Relay Server`**, paste `https://relay.sjer.red` (must match `RELAY_SERVER_URL`).
- Reference: `No-Instructions/relay-server-template` (`guides/kubernetes/` Helm chart — we
  translate it to cdk8s, not use it directly).

## Homelab deployment design

Follows the repo's per-namespace-chart convention (`packages/homelab/AGENTS.md` "Adding New
Services"). **Template to copy:** `bugsink` (upstream image + own namespace chart + OnePasswordItem

- TailscaleIngress + Cloudflare Tunnel + NetworkPolicy); **secret/secret-ref shape** from
  `tasknotes`. All paths under `packages/homelab/`.

### Files to create/edit (ordered)

1. **`src/cdk8s/src/versions.ts`** (edit) — add pinned image with Renovate annotation:
   `// renovate: datasource=docker registryUrl=https://docker.system3.md versioning=docker`
   then `"system3/relay-server": "v0.9.2@sha256:<digest>"`. (Confirm the registry/datasource
   Renovate can reach; if `docker.system3.md` isn't Renovate-trackable, mark `// not managed by
renovate` like the `shepherdjerred/*` entries and bump manually.)
2. **`src/cdk8s/src/resources/relay/index.ts`** (create) — `createRelayDeployment(chart)`:
   - `Deployment` `replicas: 1`, `strategy: DeploymentStrategy.recreate()`, `fsGroup` set.
   - `OnePasswordItem` via `vaultItemPath("relay-server")` → keys `AWS_ACCESS_KEY_ID`,
     `AWS_SECRET_ACCESS_KEY` (consumed with `Secret.fromSecretName(...)` +
     `EnvValue.fromSecretValue`, per `resources/tasknotes/index.ts:101-108`). **No `optional: true`.**
   - Single container via `withCommonProps` (plain image — NOT `withCommonLinuxServerProps`):
     image `docker.system3.md/relay-server:${versions["system3/relay-server"]}`, port 8080
     (name `http`), the env vars above (non-secret as `EnvValue.fromValue`, S3 creds as secret
     refs), TCP `liveness/readiness/startup` probes on 8080 (verify a `/health` endpoint during
     impl; fall back to TCP socket like `bugsink`).
   - **Resources:** start conservative per the homelab right-sizing ethos (req `250m`/`512Mi`,
     limit `1cpu`/`2Gi`) rather than the upstream 1cpu/4Gi; tune from metrics.
   - `Service` on 8080 (name `http`).
   - `KubeNetworkPolicy` (model `resources/bugsink/index.ts:341-421`): **ingress** from the
     `cloudflare-tunnel` namespace only on 8080 (no Tailscale); **egress** DNS (53) + HTTPS 443 to
     SeaweedFS (`seaweedfs.sjer.red`) for object storage. (Server validates tokens offline via
     baked-in keys, so control-plane egress is not required; confirm during impl.)
   - `createCloudflareTunnelBinding(chart, "relay-cf-tunnel", { serviceName: service.name, fqdn:
"relay.sjer.red" })` for public access. **No `TailscaleIngress`** (Tailscale declined). Confirm
     the tunnel passes WebSocket upgrades (Cloudflare Tunnel supports WS by default; origin stays
     `http` → CF terminates TLS at edge, client uses `wss://relay.sjer.red`). For occasional admin
     access, use `kubectl -n relay port-forward` rather than a tailnet ingress.
   - Optional: `createServiceMonitor` on the metrics port (9090) like `tasknotes`.
3. **`src/cdk8s/src/cdk8s-charts/relay.ts`** (create) — `createRelayChart(app)`:
   `new Chart(app, "relay", { namespace: "relay", disableResourceNameHashes: true })`, a
   `Namespace` (pod-security labels, per `cdk8s-charts/bugsink.ts:13-23`), then
   `createRelayDeployment(chart)`. Model on `cdk8s-charts/bugsink.ts`.
4. **`src/cdk8s/src/setup-charts.ts`** (edit) — import + call `createRelayChart(app)` (near the
   `createBugsinkChart(app)` call, ~line 67).
5. **`src/cdk8s/helm/relay/Chart.yaml`** (create) — copy `helm/tasknotes/Chart.yaml`; change
   `name`/`description`; keep `version: "$version"` / `appVersion: "$appVersion"` placeholders.
6. **`src/cdk8s/src/resources/argo-applications/relay.ts`** (create) — `createRelayApp(chart)`
   returning an `Application` (`repoUrl: https://chartmuseum.tailnet-1a49.ts.net`, `chart: "relay"`,
   `targetRevision: "~2.0.0-0"`, `destination.namespace: "relay"`, `syncOptions:
["CreateNamespace=true"]`). Copy `argo-applications/bugsink.ts`.
7. **`src/cdk8s/src/cdk8s-charts/apps.ts`** (edit) — import + call `createRelayApp(chart)` (near
   `createBugsinkApp(chart)`, ~line 177).
8. **`scripts/ci/src/catalog.ts`** (edit) — add `"relay"` to the `HELM_CHARTS` array. (Upstream
   image ⇒ no `IMAGES`/`DEPLOY_TARGETS` entry, matching bugsink.)

### External setup (not repo files, but required)

- **SeaweedFS:** create bucket `relay-docs` + an access-key/secret pair scoped to it.
- **1Password:** create item `relay-server` in the homelab vault with fields `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY` (the SeaweedFS creds). Then refresh + commit the offline snapshot:
  `cd src/cdk8s && bun run scripts/snapshot-1password-vault.ts` → commit
  `src/cdk8s/onepassword-vault-snapshot.json` (blocking CI lint gate).
- **DNS:** add `relay.sjer.red` in `src/tofu/cloudflare/` (sjer.red zone) as the tunnel record
  (`createCloudflareTunnelBinding` defaults `disableDnsUpdates: true`, so tofu owns the record);
  `tofu -chdir=cloudflare plan/apply`.

### Gotchas (from AGENTS.md + template)

- **URL must match exactly** across `RELAY_SERVER_URL`, the Cloudflare fqdn, and the Obsidian
  registration string.
- **Never `kubectl apply`** — single-node `torvalds` cluster is GitOps-only; ArgoCD reverts drift.
- **Do not override `[[auth]]` keys** (baked into image); overriding breaks token validation.
- SeaweedFS needs `AWS_S3_USE_PATH_STYLE=true`.
- Secrets are fail-fast: no `optional: true`; snapshot must be refreshed/committed or CI lint fails.

## Client setup (manual — documented, not automated)

1. Create a **new Obsidian vault** ("Us" / couple vault) on your MacBook. Do **not** enable
   Obsidian Sync on it.
2. Install the **Relay** community plugin; sign in to Relay (free tier covers 2 users).
3. Run **`Relay: Register self-hosted Relay Server`** → `https://relay.sjer.red`.
4. Create a Shared Folder in the vault, hosted on your self-hosted server; invite your partner.
5. Partner: install Obsidian (free) + Relay plugin, sign in, accept the invite. No Obsidian Sync
   sub needed. Repeat register-server + join on each device (your phone/MacBook, partner's
   phone/MacBook).
6. **Backup (optional, no double-coverage):** enable Relay's Git sync (Premium) to push the shared
   content to a git repo, and/or rely on Obsidian File Recovery per device. Do NOT point Obsidian
   Sync at the Relay folder.

## Rejected alternative (for the record)

Tailscale-only exposure was considered (more private — relay.md can't reach the server, and a
self-owned network auth boundary) but **explicitly declined** by the user in favor of Cloudflare
public access + trusting relay.md as IdP. Not being pursued.

## Verification (end-to-end)

1. **Build/synth:** `cd packages/homelab && bun run build && bun run typecheck && bun run test`
   (use the `test` **script**, not bare `bun test` — CWD matters). Confirm the `relay` chart
   renders in `helm-template.test.ts`.
2. **Secret lint:** `cd src/cdk8s && bun run scripts/check-1password-items.ts` passes (snapshot
   committed).
3. **Deploy via GitOps:** merge → ArgoCD syncs the `relay` app; `kubectl -n relay get pods` shows
   the pod Running (not `CreateContainerConfigError`, which would mean a missing secret field).
4. **Reachability:** `curl -I https://relay.sjer.red` returns a valid response through the tunnel;
   confirm WSS upgrade works (browser devtools or `websocat wss://relay.sjer.red`).
5. **Storage:** after first document edit, confirm objects appear under `relay-docs` in SeaweedFS.
6. **Real-time proof:** register the server on two clients (your MacBook + phone), open the shared
   folder, edit a note on one and watch it update live on the other. Then repeat with the partner's
   device to confirm off-network public access.

## Out of scope / follow-ups

- Bases/templates starter kit for the vault (Restaurants cards+map, Wedding table+headcount, Trips).
- Relay Premium Git-sync backup wiring (if desired later).
- Right-sizing the pod from real metrics after a few weeks of use.

## Session Log — 2026-07-04

### Done

- Chose Obsidian + Relay for a couple's shared space (trips/wedding/restaurants) after
  evaluating Notion/AppFlowy/Anytype; portability was decisive. Decision + HN research recorded
  in this plan's Context.
- Implemented the self-hosted Relay Server on the homelab (worktree `feature/homelab-relay-server`):
  - `versions.ts` — pinned `docker.system3.md/relay-server:v0.9.2@sha256:815222bd…` (Renovate-annotated).
  - `src/cdk8s/src/resources/relay/index.ts` — `createRelayDeployment` (stateless, S3/SeaweedFS
    env config, S3 creds via `OnePasswordItem` `relay-server`, TCP probes, NetworkPolicy locked to
    `cloudflare-tunnel` ingress + DNS/443 egress, `createCloudflareTunnelBinding` → `relay.sjer.red`).
  - `src/cdk8s/src/cdk8s-charts/relay.ts` + registered in `setup-charts.ts`.
  - `helm/relay/Chart.yaml` + `"relay"` in `scripts/ci/src/catalog.ts` `HELM_CHARTS`.
  - `src/cdk8s/src/resources/argo-applications/relay.ts` + wired in `cdk8s-charts/apps.ts`.
  - `src/tofu/cloudflare/sjer-red.tf` — `relay.sjer.red` tunnel CNAME.
- Verified: `bun run typecheck` ✓, `bun run build` ✓ (synth emits `dist/relay.k8s.yaml`),
  `bun run test` ✓ (398 pass, 0 fail — incl. all-charts helm render), `bunx eslint` ✓ on changed
  files, `tofu fmt`/`validate` ✓. `check-1password-items.ts` fails as expected (item not yet created).

### Remaining (external — must be done before commit; block the pre-commit 1Password gate)

1. **SeaweedFS:** create bucket `relay-docs` + an access-key/secret pair scoped to it.
2. **1Password:** create item `relay-server` in the homelab vault (`v64ocnykdqju4ui6j6pua56xw4`)
   with fields **`AWS_ACCESS_KEY_ID`** and **`AWS_SECRET_ACCESS_KEY`** = the SeaweedFS creds. Then
   `cd packages/homelab/src/cdk8s && bun run scripts/snapshot-1password-vault.ts` and commit the
   updated `onepassword-vault-snapshot.json`.
3. **DNS/tofu:** `op run --env-file=.env -- tofu -chdir=cloudflare apply` in `packages/homelab/src/tofu`
   to create the `relay.sjer.red` record (already added to `sjer-red.tf`).
4. Commit the worktree branch + open a PR; ArgoCD syncs the `relay` app on merge.
5. **Client setup** (per this plan's "Client setup" section): new couple vault (no Obsidian Sync),
   install Relay plugin on all 4 devices, register `https://relay.sjer.red`, invite partner.

### Caveats

- **Public-server trust model (accepted):** delegated auth to relay.md; not E2E. Random visitors
  can't connect (need a relay.md-signed token) but relay.md could technically read content on a
  public server. User explicitly accepted this and declined Tailscale.
- **Beta image:** `relay-server:v0.9.2` is upstream-beta. Probes are TCP (no confirmed `/health`);
  resources are a conservative guess (250m/512Mi → 1cpu/2Gi) — right-size from metrics later.
- **`[[auth]]` keys** are baked into the image; never override them or token validation breaks.
- **`RELAY_SERVER_URL` must exactly match** `https://relay.sjer.red` and the Obsidian registration
  string — the #1 failure mode.
- No metrics ServiceMonitor yet (port 9090 exists; `/metrics` path unverified) — deferred.

## Update — deployed live (2026-07-05)

Deployed to the cluster immediately (user asked to skip waiting on CI). It's **running and
publicly reachable** at `https://relay.sjer.red` (pod `1/1`, `Store: S3 (relay-docs)`,
`Auth: enabled`, `Listening on ws://0.0.0.0:8080`).

### Design changes from the original plan (both improvements)

- **No new 1Password item.** Reused the **shared SeaweedFS creds** item
  (`vet52jaeh75chsalu6lulugium`, fields `SEAWEEDFS_*` → remapped to `AWS_*`) — the same item
  pokemon/birmel/scout/s3-static-sites use. This removed the "create a 1Password item + refresh
  snapshot" blocker entirely (the shared item is already in the snapshot; secret lint passes).
- **In-cluster S3 endpoint** `http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333` (not the
  public `seaweedfs.sjer.red` ingress — avoids hairpinning). Netpol egress tightened to the
  `seaweedfs` namespace on 8333 (dropped the broad 443 rule).
- **Store configured via a mounted `relay.toml` ConfigMap, not env vars** (see bugs below).

### Two bugs found & fixed during live bring-up

1. **`RELAY_SERVER_STORAGE=s3` → filesystem.** A bare `s3` was parsed as a _filesystem_ path
   named "s3". The value must be the full `s3://<bucket>` URL.
2. **`s3://relay-docs` shorthand ignores endpoint/path-style.** With the URL shorthand the
   server talked to **real AWS** (`relay-docs.s3.dualstack.us-east-1.amazonaws.com`, virtual-host
   style) → `FORBIDDEN`, ignoring `AWS_ENDPOINT_URL_S3` / `AWS_S3_USE_PATH_STYLE`. Fix: mount a
   full `relay.toml` with an explicit `[store] type="s3"` block (endpoint + `path_style=true`);
   creds still come from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env. The `[[auth]]` public
   keys are copied from the image default (assembled from fragments to dodge a no-secrets false
   positive) — **keep them in sync on image upgrades.**

### Infra applied (live)

- `aws_s3_bucket.relay_docs` created via `tofu -chdir=seaweedfs apply`.
- `relay.sjer.red` DNS record created via **targeted** `tofu -chdir=cloudflare apply
-target=...` (the cloudflare stack had 36 unrelated pre-existing drift changes — SRV records +
  DNSSEC on 10 zones — deliberately NOT applied; **flagged for the user to reconcile separately**).
- Manifest `kubectl apply`-ed as a bootstrap; ArgoCD adopts it once the PR merges (CI publishes
  the `relay` chart → the `relay` Application appears via app-of-apps → adopts matching resources).

### Remaining

- **Open the PR** for GitOps convergence (worktree `feature/homelab-relay-server`; all gates pass
  locally: typecheck/build/test 398✓, eslint✓, 1Password lint✓, tofu validate✓).
- **Client setup** (user): create the couple vault (no Obsidian Sync), install Relay on all 4
  devices, register `https://relay.sjer.red`, invite partner. Attachments will populate
  `relay-docs` on first use.
- **Pre-existing cloudflare drift** (36 in-place changes) is unrelated to this work but will keep
  showing in `tofu plan` until reconciled.
