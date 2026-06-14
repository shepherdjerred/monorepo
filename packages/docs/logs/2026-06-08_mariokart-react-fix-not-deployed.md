# mariokart.sjer.red — React fix built but never deployed (chart/image version lag)

## Status

Complete (diagnosis only — no remediation, by user request)

## Summary

`mariokart.sjer.red` was still showing the React **"Incompatible React versions"** blank-page
crash that `2026-06-07_mariokart-react-version-skew.md` marked **Complete**. The fix is real and
the corrected image was built — but it **never reached the cluster**. The cause is a non-obvious
property of the unified versioning / version-commit-back pipeline (not a code regression). The user
reviewed the finding, considers the behavior acceptable ("this is fine, just surprising"), and asked
to document it and move on.

## Evidence chain

The app, service, ingress, and Cloudflare tunnel are all healthy (`/`, JS, CSS all return 200). The
served bundle itself is the broken artifact:

|                                               | bundle              | react versions                          | state                                                     |
| --------------------------------------------- | ------------------- | --------------------------------------- | --------------------------------------------------------- |
| **Deployed image `2.0.0-3610`**               | `index-BKwt2n5D.js` | react **19.2.6** + react-dom **19.2.7** | ❌ skew → react-dom module-load guard throws → blank page |
| **Image `2.0.0-3637`** (post-fix `31c301543`) | `index-DZhakH1C.js` | both **19.2.7**                         | ✅ fixed (verified via `crane export`)                    |

- `origin/main`'s `versions.ts` correctly pins the image to `2.0.0-3637`.
- ArgoCD `mario-kart` reports **Synced / Healthy** — because it tracks a **ChartMuseum** chart
  (`repoURL=https://chartmuseum.tailnet-1a49.ts.net`, `targetRevision: ~2.0.0-0`), and the latest
  published chart **`mario-kart-2.0.0-3637` templates image `2.0.0-3610`**. The chart and image
  share a version number but are **not the same release**. Live state matches the (wrong) chart, so
  ArgoCD sees nothing to do.
- Charts lag their own version number on the image tag:

  | chart           | embeds image |
  | --------------- | ------------ |
  | 3637 (deployed) | 3610         |
  | 3628            | 3610         |
  | 3610            | 3573         |

## Root cause (structural lag)

The Helm chart's image tag comes from `versions.ts` **at synth time**, but `versions.ts` is updated
to point at a freshly-built image only by an **asynchronous auto-merge PR** — the version-commit-back
(`.dagger/src/release.ts:818`, which does `git push` → `gh pr create` → `gh pr merge --auto`). So in
build N:

1. image `2.0.0-N` is built (with the current code, e.g. the React fix);
2. the chart is published as `2.0.0-N` (`helm.ts:79`, `--version 2.0.0-$BUILDKITE_BUILD_NUMBER`) but
   embeds the image tag in `versions.ts` as of that checkout — the **previous** image;
3. a commit-back PR is opened to set `versions.ts → 2.0.0-N`; it auto-merges **later**.

The chart that embeds image N can therefore only be published by a **subsequent** build that runs
after the commit-back merges (the `isVersionCommitBack` fast-track in
`scripts/ci/src/change-detection.ts:848` scopes such merges to `homelab` precisely so the new digests
"flow through cdk8s synth → Helm push → ArgoCD").

## Proximate cause (the catch-up build was canceled)

The `→3637` commit-back merged as `29cb21f0a` and triggered build **3654**, which should have
published the chart embedding image `3637`. It was **canceled** before that happened
(`bk build view 3654`):

```
build 3654  canceled  | chore: bump image versions to 2.0.0-3637
  canceled  :shield: Quality Gate
  canceled  :helm: Push mario-kart      ← never completed
```

No `2.0.0-3654` chart exists in ChartMuseum. ~7 main builds were canceled in the same window
(3654 / 3637 / 3635 / 3628 / 3626 / 3610 / 3609): **12 commits landed on `main` in ~8 minutes
(02:02–02:10)** and Buildkite cancels superseded branch builds. So the chart that would carry the
fix to the cluster was repeatedly killed mid-flight.

**Net effect:** an image fix only reaches the cluster if a _subsequent_ helm-push survives to
completion. Rapid `main` commits routinely cancel those, so **image fixes can be silently
stranded** — built and pinned in `versions.ts`, but never charted, while ArgoCD reports
Synced/Healthy on the stale chart.

## Current state

Build **3659** (HEAD `71c028105`, `buildAll` via a `.dagger/` change) ran on a checkout with
`versions.ts = 2.0.0-3637` and would have published `mario-kart-2.0.0-3659` embedding image `3637`
(→ ArgoCD auto-syncs `~2.0.0-0` → page recovers). It **failed**, so the page did **not** self-resolve
— the fix stays stranded until the next `buildAll` survives quality gates long enough to publish a
chart embedding image `3637`. **No manual action was taken** (per user); forcing it out (manual chart
publish or pinning the deployment to `2.0.0-3637`) is the out-of-scope remediation in
**Deferred / not doing**.

## Deferred / not doing

The behavior is documented, not fixed. Durable options surfaced but explicitly **not** implemented:

1. **Make chart + image atomic** — synth the chart with the just-built image digest in the **same**
   build, instead of reading the lagging `versions.ts`. Eliminates the whole class of bug.
2. **Protect deploy/helm-push from cancellation** — e.g. run the commit-back deploy on a
   non-cancelable concurrency group so the catch-up always completes.
3. **Invariant check** — fail when `versions.ts` at HEAD pins an image newer than any published chart
   references (cheap detector that would have surfaced this immediately).

## Session Log — 2026-06-08

### Done

- Root-caused why the (already-shipped) React skew fix never reached `mariokart.sjer.red`: the
  ChartMuseum chart `mario-kart-2.0.0-3637` embeds the pre-fix image `2.0.0-3610`; the corrected
  image `2.0.0-3637` was built and pinned in `versions.ts` but never charted because catch-up build
  **3654** was canceled in a rapid-commit burst.
- Verified the fixed vs broken bundles directly (`crane export` of images 3637 and 3610), the
  ChartMuseum chart→image mapping, the pipeline lag (`.dagger/src/release.ts:818`, `helm.ts:79`,
  `change-detection.ts:848`), and the canceled build (`bk build view 3654`).
- Documented the structural lag + cancellation-stranding behavior here and as a caveat in
  `decisions/2026-04-04_unified-versioning-strategy.md`.

### Remaining

- None for this scope (documentation only). The live page will only recover when a `buildAll`
  survives to publish a chart embedding image `3637` — build 3659 (the candidate at writing)
  **failed**, so this had not happened as of this log.
- If a durable fix is later wanted, see **Deferred / not doing** above (atomic chart+image is the
  highest-value option).

### Caveats

- Charts and images share a version number but are **not** the same release — `mario-kart-2.0.0-3637`
  ≠ image `2.0.0-3637`. Do not assume a chart version implies the matching image is deployed.
- ArgoCD reporting **Synced/Healthy** does **not** imply the latest built image is running — it only
  means live state matches the latest _published chart_, which may embed an older image.
