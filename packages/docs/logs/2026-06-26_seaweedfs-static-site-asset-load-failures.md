---
id: log-2026-06-26-seaweedfs-static-site-asset-load-failures
type: log
status: complete
board: false
---

# SeaweedFS static-site intermittent asset-load failures (scout-for-lol + others)

## Symptom

Scout-for-LoL site (`scout-for-lol.com`) "very very often" fails to load all assets
on first load; a refresh fixes it. Suspected to affect other SeaweedFS-backed sites too.

## Architecture (how these sites are served)

Browser → Cloudflare → Cloudflare Tunnel → **Caddy (`s3-static-sites`, single replica,
BestEffort)** running the custom `ghcr.io/shepherdjerred/caddy-s3proxy` image →
**SeaweedFS S3 gateway** → filer → volume. One Caddy deployment serves _all_ static
buckets (scout, sjer-red, better-skill-capped, ts-mc, resume, webring, cook, stocks,
public, clauderon, …). Config: `packages/homelab/src/cdk8s/src/misc/s3-static-site.ts`,
`.../resources/s3-static-sites/sites.ts`.

## Root cause (confirmed mechanism)

caddy-s3proxy intermittently gets **`HTTP 403 SignatureDoesNotMatch`** from the
SeaweedFS S3 gateway when fetching an object. On any non-2xx, s3proxy serves the
configured error page (`404.html`), which **does not exist in the buckets**
(`NoSuchKey`), so the browser receives a bare **404** for that asset → the asset is
missing. Refresh re-requests; the signature usually matches the next time → works.
This exactly matches "not all assets load on first try, refresh fixes it."

Evidence collected live:

- Caddy logs: 24 `SignatureDoesNotMatch` in ~15 min across **multiple buckets**
  (`sjer-red`, `scout-frontend`, `better-skill-capped`, `ts-mc`) → confirms "other
  SeaweedFS sites too." Most recent live failure during the session: `bucket=sjer-red
key=/favicon.ico` (real browser traffic).
- SeaweedFS S3 metric `SeaweedFS_s3_request_total{bucket="",code="403",type="GET"}=27`
  — **empty bucket label** = rejected at the auth layer before bucket resolution
  = signature failures.
- **Bursty / clustered** (e.g. ~18 within one minute post-restart), not uniform.
- Clock skew **ruled out**: caddy pod vs s3 gateway < 1s (same node `torvalds`).
- My own externally-generated, well-formed concurrent SigV4 GETs (300 req × 50
  concurrency) succeeded **100%** against _both_ the public Cloudflare endpoint and
  the in-cluster endpoint → Cloudflare does not corrupt well-formed SigV4 GETs in
  general; the failing requests are caddy-s3proxy's AWS-SDK-Go requests under a
  transient condition not reproducible on demand. Leading (unproven) hypothesis:
  a SigV4 race against SeaweedFS 4.28's newer credential-manager / a cold-connection
  signer race; correlates with post-restart bursts.

## Amplifiers (definite — these are what the fix targets)

1. **In-cluster Caddy reached in-cluster SeaweedFS via the PUBLIC Cloudflare endpoint.**
   `S3_ENDPOINT` was unset, so the Caddyfile default `https://seaweedfs.sjer.red` was
   used (→ Cloudflare IPs 172.67.x/104.21.x). Every cache-miss asset hairpinned out to
   Cloudflare and back instead of using the in-cluster service. Doubled latency, made
   internal serving depend on Cloudflare, and is a textbook SigV4-behind-reverse-proxy
   hazard (SeaweedFS issue #6086). Every other in-cluster service (scout/birmel/pokemon)
   already uses `http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333`; the static-sites
   Caddy was the lone outlier.

2. **No edge/browser caching of immutable assets.** Content-hashed Vite/Astro assets
   (`/_astro/*`, `/app/assets/*`) returned `cf-cache-status: MISS` with only Cloudflare's
   default 4h browser TTL — Caddy set **no `Cache-Control`**. So every visit re-fetched
   everything from origin (incl. the 1.6 MB `/app/assets/index-*.js`, observed p50 ≈
   600 ms / max 1.7 s), maximizing S3 GETs and thus exposure to the intermittent 403.

## Fix implemented

Scope chosen by owner: **edge-cache immutable assets + use the in-cluster S3 endpoint.**

- `sites.ts`: `S3_ENDPOINT` → `http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333`
  (removes the Cloudflare hairpin + the reverse-proxy SigV4 hazard; cuts latency).
- `s3-static-site.ts`: new optional `immutableAssetPaths` per-site config + a
  `renderImmutableAssetBlock` helper that emits a Caddy `@immutableAssets path …` matcher
  and `header @immutableAssets Cache-Control "public, max-age=31536000, immutable"`.
  Defaults to `["/_astro/*"]` (Astro's hashed dir; harmless on non-Astro sites). The two
  scout sites add `/app/assets/*` (the Vite SPA bundle). `/app/index.html` and other
  mutable paths are deliberately excluded so deploys still take effect.
- Bucket-lifecycle invariant (documented in `sites.ts` + the `immutableAssetPaths` JSDoc,
  per Greptile review): never prune old `/app/assets/*` objects. The `/app/*` SPA fallback
  serves `/app/index.html` (200) for any missing key under `/app/*`, and the immutable
  matcher stamps the 1-year `Cache-Control` on that response too — so a request for a
  pruned hashed asset would cache HTML at a `.js` URL at the edge for a year. Content-hashed
  builds keep every build's output, so the condition can't arise in practice.
- Tests added in `s3-static-site.test.ts` (default header, per-site override, disable,
  ordering, helper unit tests).

Once Cloudflare edge-caches the immutable assets, repeat visits never reach the origin,
so the intermittent SeaweedFS 403 almost never reaches a user — and the site is far
faster. The endpoint change removes one whole failure surface (Cloudflare in the path).

### Verification

- `bun run typecheck` ✓ · `bunx eslint` (changed files) ✓ · `bun test
src/misc/s3-static-site.test.ts` → 37 pass ✓
- `dagger call caddyfile-validate --source=.` → **"Valid configuration"** (the real
  custom caddy-s3proxy binary loaded the generated Caddyfile + 21 dagger tests pass) ✓

## Not done (deferred — see "Remaining")

- Upstream root cause of the SigV4 race (SeaweedFS 4.28 credential-manager) — needs
  `-v=4` repro over a longer window.
- caddy-s3proxy retry-on-403 + 2 replicas / resource requests (resilience).
- Secondary bugs: missing `404.html` in buckets (bare 404 on every miss); `/favicon.svg`
  referenced by the scout marketing root but absent from the bucket (deterministic 404);
  304-Not-Modified logged as an error by the fork.

## Post-deploy verification (after ArgoCD applies)

- `curl -sI https://scout-for-lol.com/app/assets/<hashed>.js` → `cache-control:
public, max-age=31536000, immutable` and (on a warm PoP) `cf-cache-status: HIT`.
- `kubectl exec -n s3-static-sites deploy/s3-static-sites -- printenv | grep S3` is moot;
  confirm via the rendered ConfigMap Caddyfile `endpoint …svc.cluster.local:8333`.
- Watch `kubectl exec -n seaweedfs <s3-pod> -- wget -qO- localhost:9327/metrics | grep
'code="403"'` — the GET 403 counter should grow far more slowly relative to traffic.

## Session Log — 2026-06-26

### Done

- Diagnosed the intermittent asset-load failures end-to-end against the live cluster:
  caddy-s3proxy → SeaweedFS `SignatureDoesNotMatch` 403 → missing-error-page → bare 404
  → broken asset; affects all SeaweedFS static sites. Ruled out clock skew; reproduced
  the genuine `/favicon.svg` 404; captured before-baseline metrics.
- Implemented the owner-selected fix in worktree `seaweedfs-asset-fix`
  (branch `fix/seaweedfs-asset-loading`): in-cluster `S3_ENDPOINT`; per-site
  `immutableAssetPaths` + immutable `Cache-Control` for `/_astro/*` (all sites) and
  `/app/assets/*` (scout). Added unit tests.
- Verified: typecheck, eslint, 37 unit tests, and the real Dagger `caddyfile-validate`
  all green.

### Remaining

- Open PR, get through CI (Buildkite) + Greptile, merge → ArgoCD deploy.
- Run the Post-deploy verification above.
- Optional follow-ups (separate PRs): upstream SeaweedFS SigV4 root cause; caddy
  retry-on-403 + replicas/resources; add `404.html` to buckets; fix `/favicon.svg`.

### Caveats

- The fix is a strong _mitigation + correctness_ change, not a proven cure for the
  upstream SeaweedFS SigV4 race — the first origin fill per PoP per deploy can still
  hit it. Combined with the endpoint change (Cloudflare removed from the internal path)
  the user-visible symptom should drop dramatically, but if a 403 burst recurs after a
  SeaweedFS restart, the credential-manager hypothesis is the next thread to pull.
- `immutableAssetPaths` defaults to `/_astro/*` only; Vite-SPA sites other than scout
  (better-skill-capped, clauderon use `/assets/*`) are intentionally left on the 4h
  default until their build layout is confirmed — add per-site if desired.
