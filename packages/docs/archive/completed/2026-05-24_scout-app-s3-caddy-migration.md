---
id: reference-completed-2026-05-24-scout-app-s3-caddy-migration
type: reference
status: complete
board: false
---

# Scout-app: serve SPA from shared Caddy, kill the broken in-cluster Caddy

## Context

`scout-app-{beta,prod}` Deployments have been in `ImagePullBackOff` for 12h+:
the image `ghcr.io/shepherdjerred/scout-app:0.0.1-dev` was never published
(commit `8747bf4d3` added the cdk8s Deployment + `versions.ts` pin but never
wired `scout-app` into the CI image catalog — `gh api .../packages/container/scout-app`
returns 404).

The user wants to delete the Caddy-in-K8s detour and serve the React SPA via
the existing shared-Caddy + SeaweedFS pattern (same one that already serves
the Astro marketing site at `scout-for-lol.com`), with the backend Deployment
reused for `/trpc` and `/api` over a cross-namespace reverse-proxy. Path-based
single-hostname routing must stay (`app.ts:25-27` calls out same-origin
cookies + `SameSite=Strict`).

## Today

```
                  ┌──────────────────────────────────────────────────────────┐
                  │                    Cloudflare Tunnel                     │
                  └──────────────────────────────────────────────────────────┘
                         │                                       │
        scout-for-lol.com│                  scout-for-lol.com    │  /app/
        (TunnelBinding A)│                  (TunnelBinding B)    │  + /trpc + /api
                         ▼                                       ▼
              ┌──────────────────────┐            ┌───────────────────────┐
              │   s3-static-sites    │            │   scout-app-{stage}   │
              │   Caddy + s3proxy    │            │   Caddy in-cluster    │
              │   ns: s3-static-sites│            │   ns: scout-{stage}   │
              └──────────────────────┘            │   ❌ ImagePullBackOff │
                         │                        └───────────────────────┘
                         ▼                                       │
              SeaweedFS scout-frontend (Astro)      /trpc, /api ─┘──▶ scout-service-{stage}:3000
                                                                       (backend, healthy)
```

## Target

```
                  ┌──────────────────────────────────────────────────────────┐
                  │                    Cloudflare Tunnel                     │
                  └──────────────────────────────────────────────────────────┘
                                            │
                              scout-for-lol.com  (ONE TunnelBinding)
                                            ▼
                            ┌──────────────────────────────┐
                            │       s3-static-sites        │
                            │       Caddy + s3proxy        │
                            │       ns: s3-static-sites    │
                            └──────────────────────────────┘
                                  │                  │
                       /  /app/*  │                  │  /trpc*  /api/*
                       (static)   │                  │  (reverse-proxy
                                  ▼                  ▼   cross-namespace)
                  ┌────────────────────────┐   ┌─────────────────────────┐
                  │  SeaweedFS s3://       │   │ scout-service-prod      │
                  │     scout-frontend     │   │ .scout-prod.svc:3000    │
                  │  ├── /index.html …     │   │ → scout-backend pod     │
                  │  │     (Astro)         │   │   (Bun HTTP, same image │
                  │  └── /app/…            │   │    as Discord bot)      │
                  │       (Vite SPA)       │   └─────────────────────────┘
                  └────────────────────────┘
```

Single hostname, single tunnel binding, same-origin cookies preserved.

## Issues — de-risked

| #   | Issue                                         | Status               | Resolution                                                                                                                                                                                                |
| --- | --------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cross-ns NetworkPolicy blocks Caddy → backend | ✅ verified          | `scout-ingress-netpol` in `cdk8s-charts/scout.ts:32-57` allows `prometheus`, in-ns, `cloudflare-operator-system`. Swap `cloudflare-operator-system` → `s3-static-sites` (CF tunnel terminates there now). |
| 2   | Caddy ConfigMap reload                        | ✅ resolved by plan  | No reloader in cluster. Add SHA256-of-Caddyfile annotation on `s3-static-sites` Deployment pod template → ConfigMap changes force a rollout.                                                              |
| 3   | Single-bucket `--delete` footgun              | ⚠️ needs build guard | Merged build script must `set -euo pipefail` AND assert `dist/app/index.html` exists before returning.                                                                                                    |
| 4   | Vite `base` + React `basename` mismatch       | ✅ already correct   | `main.tsx:23` has `basename="/app"`, `vite.config.ts:8` has `base: "/app/"`. No SPA code change.                                                                                                          |
| 5   | Probe coverage drop                           | ✅ resolved by plan  | Add `StaticSiteProbeConfig` entries for `/app/` and `/api/healthz` in `sites.ts` (the schema already supports `path: "/...".`).                                                                           |
| 6   | DNS caching on backend rollouts               | ✅ mitigated         | Set `lb_policy round_robin` + `dial_timeout 5s` in the Caddy reverse_proxy block (Caddy re-resolves on connection errors).                                                                                |
| 7   | `order s3proxy last` vs explicit `handle`     | ✅ POC'd             | Validated against `ghcr.io/shepherdjerred/caddy-s3proxy` image — `handle` blocks take precedence; s3proxy only matches unhandled requests. Exit 0, "S3 proxy initialized".                                |
| 8   | WebSockets in backend HTTP server             | ✅ N/A               | `http-server.ts` is plain HTTP only; Discord WS is outbound from the bot, not served.                                                                                                                     |
| 9   | Discord OAuth callback URL                    | ✅ unchanged         | `/api/auth/discord/callback` stays on same hostname.                                                                                                                                                      |
| 10  | Build envvar bleed across Astro + SPA         | ⚠️ accept            | Both frameworks ignore unknown `PUBLIC_*` vars; will document and move on.                                                                                                                                |

## Implementation

### Phase A — homelab (cdk8s)

**A1. `packages/homelab/src/cdk8s/src/misc/s3-static-site.ts`**

Extend `StaticSiteConfig`:

```ts
export type StaticSiteReverseProxy = {
  path: string; // Caddy path matcher, e.g. "/trpc*" or "/api/*"
  upstream: string; // e.g. "scout-service-prod.scout-prod.svc.cluster.local:3000"
  rewriteTo?: string; // optional Caddy `rewrite *` target before proxy
  // — used for /api/healthz → /healthz (backend doesn't expose /api/healthz natively)
};

export type StaticSiteConfig = {
  hostname: string;
  bucket: string;
  indexFile?: string;
  notFoundPage?: string;
  probes?: StaticSiteProbeConfig[];
  reverseProxies?: StaticSiteReverseProxy[]; // NEW
};
```

In `generateCaddyfile`, emit per-site `handle` blocks BEFORE the fall-through
s3proxy block. **Critical**: more-specific paths must come first (Caddy
evaluates `handle` blocks by registration order, not specificity):

```caddy
http://scout-for-lol.com {
    @noTrailingSlash path_regexp ^/[^.]*[^/]$
    redir @noTrailingSlash {uri}/ 301

    # Most-specific first: /api/healthz rewrites to /healthz before proxy
    handle /api/healthz {
        rewrite * /healthz
        reverse_proxy scout-service-prod.scout-prod.svc.cluster.local:3000 {
            lb_policy round_robin
            lb_try_duration 5s
        }
    }
    handle /trpc* {
        reverse_proxy scout-service-prod.scout-prod.svc.cluster.local:3000 {
            lb_policy round_robin
            lb_try_duration 5s
        }
    }
    handle /api/* {
        reverse_proxy scout-service-prod.scout-prod.svc.cluster.local:3000 {
            lb_policy round_robin
            lb_try_duration 5s
        }
    }

    handle {
        s3proxy { ... existing ... }
    }
}
```

The generator should sort `reverseProxies` so entries with `rewriteTo`
(typically more-specific health endpoints) emit before non-rewriting entries
with overlapping prefixes.

Add a config-hash annotation on the Deployment pod template (in the
`S3StaticSites` constructor, around the existing `deployment` construction):

```ts
import { createHash } from "node:crypto";
const caddyfileHash = createHash("sha256")
  .update(caddyfile)
  .digest("hex")
  .slice(0, 12);

// after `new Deployment(...)`:
ApiObject.of(deployment).addJsonPatch(
  JsonPatch.add(
    "/spec/template/metadata/annotations/caddyfile-hash",
    caddyfileHash,
  ),
);
```

Existing tests in `packages/homelab/src/cdk8s/src/__tests__/` cover the
generator — extend `generateCaddyfile` test to assert handle blocks render
for sites with `reverseProxies`.

**A2. `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts:13`**

Replace the existing scout entry with two entries (one per stage), each
pointing at its own bucket and own backend Service:

```ts
{
  hostname: "scout-for-lol.com",
  bucket: "scout-frontend",
  reverseProxies: [
    { path: "/api/healthz", upstream: "scout-service-prod.scout-prod.svc.cluster.local:3000", rewriteTo: "/healthz" },
    { path: "/trpc*",       upstream: "scout-service-prod.scout-prod.svc.cluster.local:3000" },
    { path: "/api/*",       upstream: "scout-service-prod.scout-prod.svc.cluster.local:3000" },
  ],
  probes: [
    { endpoint: "app",     path: "/app/",        module: "http_2xx" },
    { endpoint: "healthz", path: "/api/healthz", module: "http_2xx" },
  ],
},
{
  hostname: "beta.scout-for-lol.com",
  bucket: "scout-frontend-beta",
  reverseProxies: [
    { path: "/api/healthz", upstream: "scout-service-beta.scout-beta.svc.cluster.local:3000", rewriteTo: "/healthz" },
    { path: "/trpc*",       upstream: "scout-service-beta.scout-beta.svc.cluster.local:3000" },
    { path: "/api/*",       upstream: "scout-service-beta.scout-beta.svc.cluster.local:3000" },
  ],
  probes: [
    { endpoint: "app",     path: "/app/",        module: "http_2xx" },
    { endpoint: "healthz", path: "/api/healthz", module: "http_2xx" },
  ],
},
```

**One-time operator step**: create the `scout-frontend-beta` bucket in
SeaweedFS before merging — `aws s3 sync` against a non-existent bucket
fails with `NoSuchBucket`. Use the same pattern as the existing buckets
(check `op` for SeaweedFS root creds; `aws --endpoint-url https://seaweedfs.sjer.red s3 mb s3://scout-frontend-beta`).

**A3. `packages/homelab/src/cdk8s/src/cdk8s-charts/scout.ts:32-57`** (applies to both stages)

- Remove `import { createScoutAppDeployment }` and the `createScoutAppDeployment(chart, stage)` call (line 4, 26).
- In `scout-ingress-netpol`, replace the `cloudflare-operator-system`
  namespaceSelector entry with `s3-static-sites`:

  ```ts
  { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "s3-static-sites" } } }
  ```

- Update the comment block: tunnel no longer terminates in scout-{stage}; only
  the shared Caddy from `s3-static-sites` needs ingress.

**A4. Deletions**

- `packages/homelab/src/cdk8s/src/resources/scout/app.ts` — the whole file.
- `packages/homelab/src/cdk8s/src/versions.ts:118-122` — both `shepherdjerred/scout-app/{beta,prod}` entries and their comments.
- `packages/scout-for-lol/packages/app/Dockerfile` — never wired into CI; obsolete.

### Phase B — CI (scripts/ci + Dagger)

**B1. `scripts/ci/src/catalog.ts:146-153`** — replace the single `scout-frontend`
entry with two entries (prod + beta), both running the merged build:

```ts
{
  bucket: "scout-frontend",
  name: "scout-for-lol frontend + app (prod)",
  url: "https://scout-for-lol.com",
  buildDir: "packages/scout-for-lol",
  buildCmd: "bun run scripts/build-bucket.ts",
  distDir: "packages/scout-for-lol/packages/frontend/dist",
  buildEnvVars: ["PUBLIC_PINTEREST_TAG_ID", "PUBLIC_REDDIT_PIXEL_ID"],
  workspaceDeps: "packages/frontend,packages/app",
},
{
  bucket: "scout-frontend-beta",
  name: "scout-for-lol frontend + app (beta)",
  url: "https://beta.scout-for-lol.com",
  buildDir: "packages/scout-for-lol",
  buildCmd: "bun run scripts/build-bucket.ts",
  distDir: "packages/scout-for-lol/packages/frontend/dist",
  buildEnvVars: ["PUBLIC_PINTEREST_TAG_ID", "PUBLIC_REDDIT_PIXEL_ID"],
  workspaceDeps: "packages/frontend,packages/app",
},
```

Dagger's layer cache makes the second entry's build phase a no-op — only
the `aws s3 sync` runs twice. Beta and prod always serve the same SPA bytes;
backend isolation is per-stage via the reverseProxies in `sites.ts`.

**B2. New script `packages/scout-for-lol/scripts/build-bucket.ts`** (Bun):

```ts
#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync, cpSync, rmSync } from "node:fs";

await $`bun run --filter='./packages/frontend' build`; // Astro → packages/frontend/dist
await $`bun run --filter='./packages/app' build`; // Vite  → packages/app/dist

const appDist = "packages/app/dist";
const target = "packages/frontend/dist/app";
if (!existsSync(`${appDist}/index.html`)) {
  throw new Error(
    `SPA build did not produce ${appDist}/index.html — refusing to sync`,
  );
}
rmSync(target, { recursive: true, force: true });
cpSync(appDist, target, { recursive: true });
if (!existsSync(`${target}/index.html`)) {
  throw new Error(`copy failed: ${target}/index.html missing`);
}
```

The fail-fast assertions address issue #3 (the `--delete` footgun).

**B3. Change detection** — `scripts/ci/src/catalog.ts:258` maps
`scout-for-lol → scout-frontend` for the prod entry. Confirm the
PACKAGE_TO_SITE mapping supports multiple sites per package (or split the
mapping to fan out to both `scout-frontend` and `scout-frontend-beta`).
The Bun workspace filter on `packages/app` means any change there now
also triggers both bucket deploys.

### Phase C — Verify

Run in order; each must succeed before the next.

1. **Caddyfile validation** — local POC (already done):

   ```bash
   cat /tmp/Caddyfile | docker run --rm -i --entrypoint sh \
     ghcr.io/shepherdjerred/caddy-s3proxy:latest \
     -c 'cat > /tmp/Caddyfile && caddy validate --config /tmp/Caddyfile --adapter caddyfile'
   ```

2. **cdk8s synth diff** — `cd packages/homelab && bun run synth` and confirm:
   - `scout-app-{beta,prod}` resources are gone
   - `s3-static-sites` Caddyfile ConfigMap contains the new handle blocks
   - `scout-ingress-netpol` allows `s3-static-sites` namespace
3. **`bun run scripts/build-bucket.ts`** locally — confirm `packages/frontend/dist/index.html` AND `packages/frontend/dist/app/index.html` exist with reasonable sizes.
4. **`bun run typecheck` and `bun test`** in `packages/homelab`.
5. **After merge → ArgoCD sync** (verify both stages):
   - `kubectl get pods -n scout-{beta,prod}` — no more `scout-app-*` pods, backend pods still Running.
   - `kubectl rollout status deploy/s3-static-sites -n s3-static-sites` — rolled with new hash annotation.
   - For each hostname (`scout-for-lol.com`, `beta.scout-for-lol.com`):
     - `curl -I https://<host>/` → 200, Astro homepage.
     - `curl -I https://<host>/app/` → 200, SPA index.
     - `curl https://<host>/api/healthz` → 200 from the correct backend.
     - `curl https://<host>/trpc/<a-public-endpoint>` → routes to backend, not 404 from Caddy.
   - Browser smoke on prod: Discord OAuth end-to-end (cookie set, redirect, session active in SPA).
6. **Backend rollout test** — bounce `scout-prod-scout-backend` pod and verify `https://scout-for-lol.com/api/healthz` keeps returning 200 within ~5s (validates `lb_try_duration` mitigates DNS-cache staleness).

## Blackbox monitoring

Each stage gets three blackbox probes via the existing `Probe` resources
that `S3StaticSites` already creates (scraped every 60s by
`prometheus-prometheus-blackbox-exporter.prometheus:9115`). Labels
(`site`, `endpoint`, `path`) match the existing convention so dashboards
and alert rules already keyed off `probe_success{site="..."}` pick the
new endpoints up automatically — no PrometheusRule edits required.

| Endpoint       | What it proves                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `/` (auto)     | Astro homepage in the bucket is reachable; tunnel + s3proxy work                                              |
| `/app/`        | SPA `index.html` deployed under `/app/`; bucket layout correct                                                |
| `/api/healthz` | Cross-namespace reverse-proxy → backend works (covers /api + Caddy rewrite + cluster DNS + NetworkPolicy hop) |

`/trpc` isn't probed directly — it shares the upstream and proxy code with
`/api/*`, so `/api/healthz` covers the failure modes that would also break
`/trpc`. If a future tRPC public health query is added, drop a fourth probe
in then.

Total: 3 probes × 2 stages = 6 new blackbox monitors.

## Decisions locked in

- **Beta + prod both get proper deployment** (two buckets, two sites.ts entries, two CI deploy entries pointing at the same merged build).
- **Merged build script** (`build-bucket.ts`) bundles Astro + SPA into one dist; single sync per bucket; fail-fast guards prevent the `--delete` footgun.
- **Single hostname per stage** — no `app.` subdomain. Preserves same-origin cookies and Discord OAuth callback URL.

## Out of scope (worth flagging)

- **SPA versioning / staged promotion**: today beta and prod sync the same bytes on every main merge. If we later want beta to lead prod for SPA changes, that's a separate plan (versioned SPA artifacts, manual prod pin).
- **404 page**: shared Caddy renders `404.html` from the bucket. Confirm Astro produces one; if not, add one in a follow-up.

## Session Log — 2026-05-24

### Done

- **A1**: Extended `StaticSiteConfig` in [s3-static-site.ts](../../homelab/src/cdk8s/src/misc/s3-static-site.ts) with `reverseProxies`, `spaFallbacks`, and a SHA256 `caddyfile-hash` pod-template annotation. Generator emits explicit `handle` blocks (rewriteTo entries sorted before non-rewriting overlapping prefixes; SPA fallbacks split the bucket into per-prefix s3proxy instances with `errors 404 <fallbackPath>`).
- **A1b**: 22 unit tests (12 existing + 8 new for reverseProxies + 2 for spaFallbacks; covers ordering, lb_policy, rewrite, fallthrough, hash determinism).
- **A2**: Added prod + beta scout entries to [sites.ts](../../homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts) — both with /trpc + /api reverseProxies, /api/healthz rewrite-to /healthz, /app/\* SPA fallback, blackbox probes for /app/ and /api/healthz.
- **A3**: [scout.ts](../../homelab/src/cdk8s/src/cdk8s-charts/scout.ts) — removed `createScoutAppDeployment` call, swapped netpol namespaceSelector from `cloudflare-operator-system` to `s3-static-sites`.
- **A4**: Deleted [scout/app.ts](../../homelab/src/cdk8s/src/resources/scout/app.ts) (188 lines), [Dockerfile](../../scout-for-lol/packages/app/Dockerfile) (43 lines), and the two `shepherdjerred/scout-app/*` entries in versions.ts.
- **B1**: [catalog.ts](../../../scripts/ci/src/catalog.ts) — DEPLOY_SITES now has prod + beta scout entries; PACKAGE_TO_SITE migrated to `Record<string, string[]>` so scout-for-lol fans out to both buckets. validate-catalog + filterSites + the validate-catalog.test.ts all updated for the new shape.
- **B2**: New [build-bucket.ts](../../scout-for-lol/scripts/build-bucket.ts) — builds Astro + Vite SPA, copies SPA into `frontend/dist/app/`, fail-fast on missing artifacts. Verified locally (with dummy `PUBLIC_PINTEREST_TAG_ID` + `PUBLIC_REDDIT_PIXEL_ID`) — produces `dist/index.html` (65KB Astro) + `dist/app/index.html` (339B Vite SPA referencing `/app/assets/...`).
- **Scope addition**: Discovered the old scout-app Caddy had `try_files /app/index.html` for SPA deep-link fallback. Without it, hard-refreshes on `/app/login`, `/app/g/123/audit` etc. would 404. Added `spaFallbacks` field + per-prefix s3proxy with `errors 404 /app/index.html`. POC'd via `caddy validate` against the actual `caddy-s3proxy` image (Valid configuration).
- **Verification**: cdk8s typecheck clean (only pre-existing helm-types errors). scripts/ci typecheck clean. 22/22 s3-static-site tests pass; 166/166 scripts/ci tests pass; 98 cdk8s tests pass (5 skip pre-existing). 250-line synthed Caddyfile validates against the real `caddy-s3proxy` image. `validateCatalog()` runs clean (28 packages, 7 with images, 6 with sites).

### Remaining

- **One-time operator step (pre-merge)**: create the SeaweedFS bucket: `op run --env-file=.env -- aws --endpoint-url=https://seaweedfs.sjer.red s3 mb s3://scout-frontend-beta`. Without this, the beta deploy step's `aws s3 sync` will fail with `NoSuchBucket` on first run.
- **Post-merge verification (manual)**: After ArgoCD sync, run the curls listed in the Verify section of this plan against both `scout-for-lol.com` and `beta.scout-for-lol.com`. Confirm Discord OAuth still works end-to-end on prod (cookie set, redirect, SPA session active).
- **Astro `/app/*` dead code**: Astro's `src/pages/app/*.astro` (8 files) prerenders pages that are no longer reachable (Vite SPA owns /app/). Worth deleting in a follow-up to avoid confusion; out of scope for this PR.

### Caveats

- **Cookie domain**: Same-origin preserved (single hostname per stage). Discord OAuth callback URL unchanged.
- **Backend port name is "metrics"** on `scout-service-{stage}` — naming wart, but irrelevant since Caddy targets the numeric port 3000.
- **DNS caching during backend rollouts**: `lb_policy round_robin` + `lb_try_duration 5s` mitigates stale Caddy DNS during pod rolls. Real-world behavior to be confirmed by the post-merge backend rollout test.
- **Build envvar bleed**: Both Astro and Vite SPA now see `PUBLIC_PINTEREST_TAG_ID` + `PUBLIC_REDDIT_PIXEL_ID` during the merged build. Both frameworks ignore unknown `PUBLIC_*` vars; benign.
