---
id: scout-minecraft-followups-2026-08-03
type: plan
status: in-progress
board: false
---

# Scout release resilience + Paper 26.2 upgrade

Two durable follow-ups from the 2026-08-02 "get main CI green" session
(`logs/2026-08-02_main-ci-green-session.md`): make Scout releases resilient to
canceled builds, and lay out the (partly upstream-blocked) Paper 26.2 upgrade.

## Part 1 — Scout release orphans (implementing now)

### Problem

The Scout archive is content-addressed by `releaseInputDigest`
(`scripts/scout-site-release.ts`), which **excluded** `sourceCommit`. But
`buildSite` bakes the commit into the deployable bytes via
`VITE_GIT_SHA` / `PUBLIC_GIT_SHA`, so `siteArchiveDigest` is commit-dependent.
Two commits with identical Scout inputs therefore shared an archive identity but
produced different bytes. When a build archived `<id>/prod.json` then got
canceled (the frequent rapid-merge cancellation) before writing
`inputs/<id>.json`, the orphaned record collided with the next same-inputs build
and failed `immutable prod archive record does not match state` — wedging every
subsequent `scout beta release` until the orphan was deleted by hand (done once
this session; it would recur).

### Fix — Option A: bind the identity to the commit

Add `sourceCommit` to the `releaseInputDigest` input hash (bumped
`scout-release-input/v1` → `/v2`). Each commit now gets a **unique** archive
identity, so a canceled build's orphan can never collide with another commit's
build; a re-run of the _same_ commit reproduces the identity and self-heals
idempotently. Extracted the hash into a testable
`computeReleaseInputDigest(...)` with a unit test asserting the commit binding.

**Why Option A over the planned Option B (make the build reproducible + drop
`sourceCommit` from the comparison):** implementation showed `VITE_GIT_SHA` is
not just a debug value — it renders a GitHub commit link in _both_ frontends'
footers (`frontend/src/components/Footer.astro`,
`app/src/components/version-info.tsx`). (The version-mismatch banner correctly
keys on `contractHash`, not the git sha — `app/src/lib/build-info.ts`.) So
Option B would delete a real footer feature across ~7 files, while Option A is a
one-line hashing change that keeps it. Trade-offs accepted: cross-commit dedup
no longer fires (it was semantically wrong anyway, since the bytes depend on the
commit), and canceled builds leave harmless orphaned partials at dead identities
(bucket lifecycle reaps them).

### Compatibility

Existing prod is unaffected: `versions/<version>.json` records and their
archives keep their old identities, and `reconcile-prod-pin` resolves prod via
the version record, so the pin and its archive still verify. Only _new_ releases
compute the new identity.

### Files / verification

- `scripts/scout-site-release.ts` (add `computeReleaseInputDigest`, call it in
  `prepareState`), `scripts/scout-site-release.test.ts` (commit-binding test).
- `bun test scripts/scout-site-release.test.ts scripts/lib/scout-site-storage.test.ts`
  green; `turbo run typecheck lint --filter=@shepherdjerred/root-scripts` clean.
- CI dry-run of the scout release subcommands exercises the path end-to-end;
  post-merge, confirm `scout beta release` passes across a later image-bump
  commit without a manual orphan cleanup.

## Part 2 — Paper 26.2 (Minecraft): blocked upstream + Renovate fix

A live smoke test this session showed Paper **26.2 boots but breaks plugins** on
the current pins: EssentialsX 2.21.0 (`26.2.build.92-stable is not in valid
version format`), LevelledMobs 4.5.1 (`No enum constant …V26_2`), Lunamatic
("Unsupported server version… Expected 1.21"). The actual bump **cannot
complete** until those plugins ship `26.x`-aware releases (java25 from PR #1958
already satisfies 26.x's Java requirement).

### Actionable now (separate PR)

Fix the Renovate `papermc` custom datasource (`renovate.json`), which emits
version **families** (`26.2`, `26.1`) rather than full pins like `26.1.2`, so
Renovate can't compute a bump against `versions.paper`. Resolve the latest full
build per family (v3 builds endpoint) or repin to a family + build. Validate with
`renovate-config-validator` under `node`.

### Checklist for the bump (when plugin releases land)

1. Confirm `26.x`-compatible releases for EssentialsX, LevelledMobs, Lunamatic
   (re-verify the rest); JAR URLs live in
   `packages/homelab/src/cdk8s/src/resources/argo-applications/minecraft-{sjerred,tsmc,shuxin}.ts`.
2. Bump `versions.paper` → `26.2.x` in `packages/homelab/src/cdk8s/src/versions.ts`
   and the incompatible plugin JAR versions.
3. Live smoke test one server (disable auto-sync, `kubectl set env … VERSION=26.2.x`,
   delete pod, confirm all plugins enable), then restore auto-sync.
4. PR (versions.ts + plugins), verify, merge, roll the three pods.

## Deferred (noted; not in this plan)

- ArgoCD global `resource.customizations.ignoreDifferences.PersistentVolumeClaim`
  (`/spec/volumeName`) in `argo-applications/argocd.ts` to stop the stale
  `Operation=Failed` on ZFS-PVC apps (golink/loki/minecraft) recurring.
- A privileged repair step for historically root-owned plugin config files.
