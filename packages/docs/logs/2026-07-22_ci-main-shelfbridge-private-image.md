---
id: log-ci-main-shelfbridge-private-image-2026-07-22
type: log
status: complete
board: false
---

# CI on main red — shelfbridge image pulled ImagePullBackOff (private GHCR package)

## Goal

Get CI on `main` green. Build [#6010](https://buildkite.com/sjerred/monorepo/builds/6010)
(commit `73c7c3bbd`) was `failed`.

## Diagnosis

The only real failure in #6010 was **`:argo: sync + wait`** (`argocd-sync`). Every
other non-green job was either a PR-dry-run step that correctly skips on `main`
(`broken`), a soft-fail gate (`trivy`, `semgrep` — non-blocking), or a downstream
job that was canceled/withheld _because_ `argocd-sync` failed
(`version-commit-back`, `ci-image-refresh` via `cancel_on_build_failing`;
`scout-prod-reconcile`, `tofu-cloudflare` via `depends_on: argocd-sync`).

`argocd-sync` runs `argocd.ts sync apps` then `tree-health-wait apps`. The `apps`
app-of-apps sync failed because child app **`media`** was **Degraded**:

- `media-shelfbridge` deployment was `0/1`, pod in **`ImagePullBackOff`** for 18h
  (`x4892` back-off events).
- Image: `ghcr.io/shepherdjerred/shelfbridge:2.0.0-5991@sha256:f3b7c4f2…`.

**Root cause:** shelfbridge's GHCR container package was **private**. GHCR defaults
a _newly-created_ package to private on its first push, and build 5991 was
shelfbridge's first-ever image push (the ebook stack / ShelfBridge landed in
PR #1587, seeded with a placeholder `0.1.0@sha256:0000…` pin in `versions.ts`,
then filled with the real `2.0.0-5991@sha256:f3b7c4f2…` by version-commit-back
in PR #1605). The cluster pulls GHCR anonymously (no imagePullSecret on media),
so a private package = `ImagePullBackOff`. Confirmed:

- Anonymous `GET manifests/sha256:f3b7c4f2…` → **401**; same request with CI's
  `GH_TOKEN` (from `buildkite-ci-secrets`) → **200**.
- `GET /user/packages/container/shelfbridge` → `"visibility":"private"`.
- Every other homelab image (birmel, streambot, …) is public → anonymous 200.

The pinned tag+digest were **valid the whole time** — this was a visibility
misconfiguration, not a bad/missing image. GHCR package visibility is web-UI only
(no REST API: the undocumented `PATCH /user/packages/container/<pkg>` 404s).

## Fix

1. **Owner flipped the package to public** via the GHCR package settings UI
   (`https://github.com/users/shepherdjerred/packages/container/shelfbridge/settings`
   → Danger Zone → Change visibility → Public). Verified anonymous pull of the
   pinned digest → **200**.
2. Deleted the stuck pod (`kubectl delete pod -n media media-shelfbridge-…`) to
   force an immediate re-pull. New pod → `Running 1/1`; `media` app → **Healthy**.
3. Retried the `argocd-sync` Buildkite job on build #6010, then the downstream
   jobs it had canceled/withheld.

## Note for future first-time images

Any _new_ `shepherdjerred/<x>` image's first push lands **private** by default and
will `ImagePullBackOff` in-cluster until someone flips it public. Watch for this
whenever a brand-new image target is added to the bake set + `versions.ts`. A
durable fix (not done here) would be either: set the package public
programmatically right after first push in `bake-images.sh`, or add an
imagePullSecret to the homelab namespaces. Left as a follow-up — out of scope for
"get main green."

## Session Log — 2026-07-22

### Done

- Root-caused #6010 failure to shelfbridge's GHCR package being private (first
  push defaults to private); image + pinned digest were valid.
- Owner flipped the package to public; verified anonymous pull → 200.
- Recovered the `media-shelfbridge` pod (delete → re-pull → `Running`); `media`
  and `apps` apps back to Healthy.
- Retried `argocd-sync` + downstream jobs on build #6010.

### Remaining

- None. Main HEAD advanced to `a8fc5d566` (PR #1579) mid-session; its fresh build
  **[#6017](https://buildkite.com/sjerred/monorepo/builds/6017)** ran against the
  now-healthy cluster: `argo: sync + wait` **passed** (the exact step that had
  been failing), build reached overall **`passed`**, and the GitHub combined
  commit status for `a8fc5d566` is **`success`**. CI on main is green.
  (Build #6010 was for the older commit `73c7c3bbd` and is left terminal-failed;
  its retried argo job was auto-canceled when #6017 superseded it — expected.)

### Caveats

- Fix is a one-click visibility change, not a code change — the same class of
  failure recurs for the _next_ brand-new image unless the durable follow-up
  (auto-public-on-first-push, or namespace imagePullSecret) is implemented.
- `golink` and `cert-manager`/`kyverno-policies` show benign non-Synced/last-op
  states unrelated to this failure (golink PVC `VolumeName` immutability diff;
  it is Healthy). Not touched.
