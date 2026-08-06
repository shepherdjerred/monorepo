---
id: plan-2026-07-25-bindery-fork-chinese-add
type: plan
status: complete
board: false
---

# Self-built Bindery fork: fix Simplified-Chinese book adds

## Context

The homelab ebook stack (Bindery → qBit → CWA → Kindle) is meant to acquire
简体中文 books the US Kindle Store doesn't carry. This session already fixed
Bindery's **metadata search** for Chinese by wiring a Google Books API key
(`googlebooks.apiKey` setting → "google books enrichment enabled"), so
searching 原子习惯 now returns results in the Add Book dialog.

But **adding** a Google Books result fails with HTTP 422 on
`POST /api/v1/author/book`:
`"Author metadata unavailable for this result. Add the author manually first…"`.

Root cause (confirmed in upstream source): Bindery is author-centric
(Author→Book). Google Books returns a book with a **Chinese author name and no
author ID**. The add handler resolves the author by name — either an existing
library author or OpenLibrary's canonical record — and **both fail for Chinese
names** (OpenLibrary only knows "James Clear", not "詹姆斯•克利爾"; name-match is
exact-key so cross-script never matches). Proven: adding James Clear (OL) first
and retrying still 422s. There is **no config/data workaround** — it needs a
code change.

Bindery is MIT/Go and self-hostable. The homelab already self-builds an
ebook-stack image (`shelfbridge`) with an established pattern, so we fork
Bindery the same way. **Decision: in-monorepo patch file (no separate fork
repo); self-host only (no upstream PR).**

## The patch (tiny, idiomatic)

Bindery already has the exact machinery needed — synthetic authors
(`dnb:…`, `calibre:author:N`) and a `resolvedByName`/`directInsertNeeded`
direct-insert path **built specifically for Google Books picks**
(`internal/api/authors.go`). The handler just **422s instead of minting a
synthetic author** when name-resolution fails.

**File:** `internal/api/authors.go` — the nested `if req.ForeignAuthorID == ""`
guard (~line 2280) inside the `AddBook` handler. Replace the 422-return with:

```go
if req.ForeignAuthorID == "" {
    if key := metadata.CanonicalAuthorKey(req.AuthorName); key != "" {
        // No canonical identity anywhere (Google Books Chinese result: author
        // name only, no provider ID, no ISBN edition). Mint a synthetic
        // library-local author keyed by name — mirrors the dnb:/calibre:author
        // synthetic precedent — so the pick can be added and its indexer search
        // can run. resolvedByName drives the existing direct-insert path.
        req.ForeignAuthorID = "gb:author:" + key
        resolvedByName = true
    } else {
        writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
            "error": "Author metadata unavailable for this result. Add the author manually first (Authors → Add Author by name), then try again.",
        })
        return
    }
}
```

Downstream needs **no change** — it already handles this: `GetAuthor("gb:author:…")`
fails → falls back to `&models.Author{ForeignID, Name, …}` → `CreateForUser` →
`authorWasJustCreated=true`; because `resolvedByName` it skips the catalogue
flood; `directInsertNeeded=true` inserts the single picked `gb:` book as Wanted,
which then triggers the ShelfBridge indexer search.

- **Reuse:** `metadata.CanonicalAuthorKey` (already used by
  `findLibraryAuthorByName` in the same file; `metadata` is already imported).
- **Idempotent / groups correctly:** the key is deterministic, so re-adding the
  same author's books reuses one synthetic author (via `GetByForeignIDForUser`,
  and `findLibraryAuthorByName` now matches its Name on later adds).
- **Optional nicety:** where the fallback author hardcodes
  `MetadataProvider: "openlibrary"` (~line 2307), set `"googlebooks"` when the
  ID has the `gb:author:` prefix. Cosmetic; can skip.
- **Test (in the patch):** add `TestAddBook_AuthorlessGoogleBooks` to
  `internal/api/authors_test.go` (mirror existing cases) asserting an authorless
  `gb:` book → 201, author created with a `gb:author:` ID, book status Wanted.

The whole change (patch + test) lives in
`packages/homelab/images/bindery/0001-gb-author-synthetic.patch`.

## Homelab self-build wiring (mirror `shelfbridge`)

1. **`packages/homelab/images/bindery/Dockerfile`** — mirror upstream's 3-stage
   build (`oven/bun:1.3.14` frontend → `golang:1.26-alpine` binary →
   `gcr.io/distroless/static-debian12:nonroot`), but **source from a pinned
   upstream commit + apply our patch** instead of a repo-root `COPY .`:
   - Add a `git`-capable stage that
     `git init && git fetch --depth 1 origin "$BINDERY_SOURCE_REF" && git checkout FETCH_HEAD`
     from `https://github.com/vavallee/bindery.git`, then
     `COPY 0001-gb-author-synthetic.patch . && git apply` it.
   - Global `ARG BINDERY_SOURCE_REF=<sha>` with a
     `# renovate: datasource=git-refs depName=bindery-source branch=main` comment
     (mirror the shelfbridge block).
   - Recommended **build-time gate:** a stage that runs
     `go test ./internal/api/ -run TestAddBook_AuthorlessGoogleBooks` so the
     build fails loudly if upstream drift breaks the patch.
   - Digest-pin all base images with inline `# renovate: datasource=docker`
     comments (copy upstream's pinned digests as the starting point).
   - Self-contained: build context is the image dir.
2. **`packages/homelab/images/bindery/0001-gb-author-synthetic.patch`** — the
   patch above (handler change + Go test).
3. **`docker-bake.hcl`** — add `"bindery"` to `group "infra"` (line ~145) and a
   `target "bindery" { context = "packages/homelab/images/bindery"; tags = ["bindery:dev"]; cache-from/to = … }`.
4. **`.buildkite/scripts/bake-images.sh`** — add `bindery` to `INFRA_IMAGES`
   (line 48).
5. **`packages/homelab/scripts/smoke-images.ts`** — add `smokeBindery()` (boot
   `bindery:dev`, wait `/api/v1/health` → 200) and a `{ label: "bindery", fn:
smokeBindery }` entry in `checks` (~line 524).
6. **`packages/homelab/src/cdk8s/src/versions.ts`** — retain the deployed
   `"vavallee/bindery"` entry and add an unused publication-stage entry:
   `"shepherdjerred/bindery": "2.0.0-0@sha256:<placeholder>"`. Main CI's
   version commit-back can seed the real digest without changing a workload.
7. **`packages/homelab/src/cdk8s/src/resources/torrents/bindery.ts:110`** —
   keep the deployment on
   `` `docker.io/vavallee/bindery:${versions["vavallee/bindery"]}` `` in this
   publication PR. A follow-up switches to the first-party key only after its
   digest resolves anonymously. The `/config` PVC then preserves the admin
   account and runtime configuration across the image swap.
8. **`renovate.json`** — add a `customManagers` git-refs entry (mirror the
   shelfbridge block, lines 64-75) for
   `packages/homelab/images/bindery/Dockerfile` → `BINDERY_SOURCE_REF` tracking
   upstream `main`.

## Rollout / operator steps

1. Create a worktree (`.claude/worktrees/bindery-fork`), do all edits there,
   open a **draft PR** early (per repo conventions), run `bun run verify --
--affected`.
2. Merge the publication PR. Main CI's `images` step builds, tests, smokes, and
   pushes `ghcr.io/shepherdjerred/bindery`; the media Deployment keeps serving
   `docker.io/vavallee/bindery`.
3. Merge the version commit-back PR that rewrites the unused seed to the real
   `2.0.0-<build>@sha256:…`.
4. A new GHCR package defaults to private. Flip it to public in GHCR settings,
   then verify an anonymous manifest request for the pinned digest succeeds.
   The cluster has no image pull secret.
5. Open a follow-up deployment-switch PR replacing the upstream image reference
   with the verified `shepherdjerred/bindery` pin. Argo then rolls Bindery while
   preserving `/config`, including the admin account, indexers, and
   `googlebooks.apiKey`.

## Remaining

- [x] Confirm the first-party Bindery tag@digest produced after PR #1643 is present in `versions.ts` and anonymously pullable after the operator visibility gate.
- [x] Merge PR #1759, which switches the deployment to the verified `shepherdjerred/bindery` pin.
- [x] After merge, hand the privileged production replay to `todos/bindery-patched-image-rollout-operator.md`; archive this plan when the deployment uses the patched image.

## Verification (end-to-end)

- **Patch, pre-image:** in the worktree, clone upstream at the pinned ref, apply
  the patch, `go test ./internal/api/ -run TestAddBook_AuthorlessGoogleBooks`
  → passes. (Also enforced by the Dockerfile test stage.)
- **Image, pre-deploy:** `docker buildx build packages/homelab/images/bindery -t
bindery:dev` succeeds; `bun packages/homelab/scripts/smoke-images.ts bindery`
  (or the smoke check) boots and `/api/v1/health` → 200.
- **E2E, post-deploy (the real proof):** against
  `https://bindery.tailnet-1a49.ts.net` with `X-Api-Key`, replay the exact
  earlier failure — `POST /api/v1/author/book` with the 原子習慣 Google Books
  search result → expect **201** (was 422); confirm the book appears in Wanted;
  confirm a ShelfBridge indexer search fires (`/api/v1/queue` or history) and the
  grab lands in qBit → `/ingest` → CWA. Then repeat from the Bindery **UI** Add
  Book dialog to confirm the 422s in the browser console are gone.

## Caveats / out of scope

- **Traditional vs Simplified:** Google Books' metadata title for this book is
  Traditional (原子習慣); Bindery searches indexers by that title, so the grabbed
  edition may be Traditional. Anna's Archive has both. Edition-language
  preference is a **separate refinement** (Bindery language filtering / manual
  release pick), not part of this fix.
- **Results with no author at all** (the greyed-out row in the screenshot) stay
  unaddable — the patch only helps when an author _name_ is present.
- **No upstream PR** (per decision): we carry `images/bindery/` + the patch
  indefinitely; Renovate advances `BINDERY_SOURCE_REF` and the build-time
  `go test` gate flags any drift that breaks the patch (rebase the `.patch`
  then).
- Unrelated open threads from this session (not part of this plan): CWA
  SMTP/Auto-Send to Kindle (blocked on the Kindle-account decision) and deleting
  the defunct `bitterlake-homeassistant` GCP project.

## Comment Log

### 2026-07-28 — public-image gate and live deployment smoke

- The operator made `ghcr.io/shepherdjerred/bindery` public. Anonymous token and
  exact pinned-manifest requests both returned HTTP 200.
- A user-authorized direct Kubernetes override deployed
  `2.0.0-6690@sha256:5a6c71a348d4a49ebd30ef3d00f6c8fb075f9e81f622d4f187e98fb7cf29c539`.
  The rollout reached one ready replica with zero restarts, startup reported
  version `6690` with Google Books enrichment enabled, and the external health
  endpoint returned `{"status":"ok","version":"6690"}`.
- Health proves the patched image runs with the preserved configuration. The
  Chinese-add API/UI and downstream acquisition replay remains operator-owned
  in `todos/bindery-patched-image-rollout-operator.md`.

### 2026-07-25 — PR #1643 review response (Codex substitute review #4780355657)

- **[P2] Synthetic identity relinkability — FIXED in the patch.** Confirmed
  against upstream source at the pinned ref (`27e9049`): `CanReplaceAuthorIdentity`
  (`internal/models/author.go`) only treated empty/`abs:`/`calibre:` IDs (or
  audiobookshelf/calibre providers) as replaceable, so a `gb:author:` synthetic
  was permanently pinned — both relink call sites (the add-flow auto-upgrade at
  `authors.go:371` and the `RelinkAuthor` auto-lookup at `authors.go:1017`, which
  returned 409 "already linked") gate on that predicate. Patch now (a) adds
  `gb:author:` to `CanReplaceAuthorIdentity`, and (b) stamps the synthetic's
  `MetadataProvider` as `"googlebooks"` (not the default `"openlibrary"`) so the
  stored row is internally consistent with `AuthorProviderFromForeignID`. Safe
  because Google Books `GetAuthor` is always unsupported (no real `gb:author:`
  identities exist) and GB book IDs are `gb:<volumeID>`, never `gb:author:`.
  `TestAddBook_AuthorlessGoogleBooks` (the Dockerfile build-gate test) extended to
  assert provider `googlebooks` + `CanReplaceAuthorIdentity == true`. All
  `internal/api`, `internal/models`, `internal/abs` Go tests pass; patch applies
  cleanly to `27e9049`.
- **[P2] Renovate auto-deploy of every upstream main commit — FIXED.** Added an
  `automerge: false` package rule for `bindery-source` in `renovate.json` (kept
  the deliberate "track `main`" design documented in the Dockerfile; the
  build-time go-test gate only covers the Chinese-add patch, not unrelated
  upstream regressions, so each `BINDERY_SOURCE_REF` bump now needs manual
  review). Note the same rolling-main + inherited-automerge shape exists for
  `shelfbridge-source`/`redlib-source`/`pokeemerald-source` (left out of scope).
- **[P1] Placeholder seed digest — RESOLVED by staged rollout.** Confirmed the pipeline
  claim: `argocd-sync` depends on `[images, helm-push, tofu-apply]` (not
  `version-commit-back`), so the merge build syncs the Helm chart with the
  all-zero placeholder digest → `ImagePullBackOff` (plus the new GHCR package is
  private). This is the same pattern shelfbridge (PR #1587) shipped, but bindery
  differs: it already runs the upstream `vavallee/bindery` image, so — unlike
  greenfield shelfbridge — a two-PR split (publish the patched image first, keep
  serving upstream; switch the deployment only after the real digest is seeded and
  the GHCR package is public) avoids any undeployable window. PR #1643 now takes
  that publication-only first stage; the first-party seed is unused by any
  workload until the follow-up switch.

### 2026-07-25 — Hosted Codex review of 15b6d29ac

- **[P1] Frontend package manager — FIXED.** The frontend stage now uses the
  repository-pinned `oven/bun:1.3.14` image, `bun install --frozen-lockfile`,
  and `bun run build`.
- **[P2] Release metadata — FIXED.** The Bindery Bake target maps CI's
  `VERSION` and `GIT_SHA` values to the Dockerfile's `VERSION` and `COMMIT`
  arguments.
- **[P1] Canonical guide — FIXED.** The ebook-stack operator guide now records
  the patched-image code map, staged publication, visibility check, digest
  gate, and later deployment switch.
