# Scout-for-LoL: Lockstep (In-Step) Stage Deploys

## Status

In Progress — design complete, implementation not started.

## Context

Prod incident (Bugsink `TypeError: … (reading 'filters')`, root-caused in
[2026-07-19_bugsink-open-issues-root-cause](../logs/2026-07-19_bugsink-open-issues-root-cause.md))
exposed **structural version skew**: the marketing site + SPA redeploy to the
prod bucket on every main build while the prod backend image is pinned
(`2.0.0-4791`, ~990 builds behind). The SPA compiles against the backend tRPC
router types (`workspace:*`) at current main — any contract change reaches prod
users immediately while the pinned prod backend can't serve it. There is no API
versioning; `@scout-for-lol/data` Zod schemas are the runtime contract.

**Goal:** each stage always serves marketing site, SPA, and backend from the
same monorepo build version (`2.0.0-$BUILDKITE_BUILD_NUMBER`).

- **Beta stays continuous** (it already is lockstep: backend pin auto-bumped by
  version-commit-back, sites synced every build).
- **Prod moves to explicit promotion**: one reviewable PR promotes a
  beta-validated version — backend pin AND prod site content move together.

## Verified current state (2026-07-19)

| Deployable                                                                                            | Beta                                                                                                     | Prod                                                                                          |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Backend image `ghcr.io/shepherdjerred/scout-for-lol`                                                  | `versions.ts:137-138` `…/beta`, auto-bumped (`update-versions.ts --commit-back`, `pipeline.yml:586-594`) | `versions.ts:140-142` `…/prod`, Renovate-annotated, manual (currently `2.0.0-4791`)           |
| Sites (one bucket dir: Astro dist + SPA at `/app/`, `packages/scout-for-lol/scripts/build-bucket.ts`) | `scout-frontend-beta` every build, placeholder pixels (`deploy-site.ts:133-150`)                         | `scout-frontend` every build, real pixels (`deploy-site.ts:118-131`) — **no version concept** |
| Routing                                                                                               | Caddy `beta.scout-for-lol.com` → beta bucket + `scout-service-beta`                                      | `scout-for-lol.com` → prod bucket + `scout-service-prod` (`s3-static-sites/sites.ts:48-96`)   |

Load-bearing facts (all verified in-tree):

- Images push **only `:$GIT_SHA` + `:latest`** (`bake-images.sh:170-174`); the
  `2.0.0-<n>` in pins is cosmetic on a digest-pinned ref → promotion must copy
  the beta line **verbatim**, never construct a tag.
- Digests are **content-gated** (rootfs-layer compare, `bake-images.sh:186-210`):
  build N may push no new image; beta pin lags harmlessly.
- Commit-back rewrites only bare or `/beta` keys (`update-versions.ts:78-83`) —
  it can never touch `/prod` pins or a new site pin.
- SPA artifact is stage-neutral (relative `/trpc`, `app/src/lib/trpc.ts:23`);
  only stage delta is pixel env vars at build time.
- Sentry release stamping for sites is **unwired**: `VITE_SENTRY_RELEASE`
  (`app/src/main.tsx:11-21`) / `PUBLIC_SENTRY_RELEASE` (`astro.config.mjs:49`)
  are read but never set by the current pipeline.
- Pipeline anchors: `sites` step (`pipeline.yml:433-446`,
  `concurrency_group: monorepo/site-deploys`), `argocd-sync` step
  (`pipeline.yml:532`), PR dry-run step (`pipeline.yml:401`).
- Bucket lifecycle precedent: `tofu/seaweedfs/buckets.tf:148-170`
  (`public_sjer_red_lifecycle`, 365d prefix expiry).

## Design

Every main build archives one **prod-flavored** site artifact to
`s3://scout-site-releases/2.0.0-<n>/` (+ sibling manifest `2.0.0-<n>.json`,
uploaded last = completeness certificate) and live-syncs the beta flavor to
`scout-frontend-beta` as today. Prod's site version becomes a pin in
`versions.ts` (`"scout-for-lol-site/prod"`) next to the image pin. A
`reconcile-prod` step on every main build compares the pin to a
`.release-version` marker object in `scout-frontend` and, only on mismatch,
syncs the prod bucket from the archive — byte-identical, no rebuild.
**Promotion = `scripts/promote-scout.ts`**: one PR setting the site pin and
copying the beta image line verbatim to the prod line. **Rollback =
`git revert`** of a promotion (or promote an older archived version). ArgoCD
(backend) and reconcile (site) key off the same commit; step ordering puts the
backend first (old-frontend/new-backend is the safe transient direction).

## Implementation

### PR 1 — infra only (must land + tofu-apply first)

- `packages/homelab/src/tofu/seaweedfs/buckets.tf`: add bucket
  `scout-site-releases` + lifecycle rule (copy `public_sjer_red_lifecycle`
  shape; prefix `""`, 365d).
- Sequencing reason: `sites` and `tofu-apply` steps have no ordering in one
  build; if the first archive sync wins, SeaweedFS auto-creates the bucket and
  tofu then needs the import-block dance (stocks precedent, `buckets.tf:38-51`).

### PR 2 — scripts + pipeline + pins + docs

1. **`scripts/lib/s3-static-site.ts`** (new; extraction): move
   `s3SyncStaticSite`, `awsEnv`, `SEAWEEDFS_ENDPOINT` out of
   `deploy-site.ts:174-314`; add `extraExcludes: string[]` (pass-2 `--exclude`,
   used to protect `.release-version` from `--delete`). Other sites unchanged.
2. **`scripts/scout-site-release.ts`** (new; subcommands, each `--dry-run`):
   - `archive --version v`: build prod flavor (`requireEnv` pixels +
     `VITE_SENTRY_RELEASE`/`PUBLIC_SENTRY_RELEASE`=v), assert
     `dist/index.html` + `dist/app/index.html`, sync to
     `scout-site-releases/<v>/`, upload manifest `<v>.json`
     (`{version, gitSha, builtAt}`) last.
   - `deploy-beta --version v`: build beta flavor (placeholder pixels verbatim
     from `deploy-site.ts:142-145` + release vars), two-pass sync to
     `scout-frontend-beta`, then write `.release-version` marker (only after
     success).
   - `reconcile-prod`: typed import of `versions.ts`; pin `"unpromoted"`
     (rollout sentinel) → log + exit 0; marker == pin → no-op; mismatch → sync
     archive to scratch dir, **fail loudly** if incomplete, two-pass sync to
     `scout-frontend`, write marker. Mid-sync crash ⇒ old marker stays ⇒ next
     build retries (converges).
   - Remove **both** scout entries from `deploy-site.ts` catalog (leaving
     `scout-frontend` would let a manual run reintroduce unversioned skew).
3. **`scripts/promote-scout.ts`** (new; operator-run):
   clean-worktree + `gh auth` preconditions → target = `--version` or beta's
   `.release-version` marker → validate `<v>.json` exists → guards: refuse if an
   open `chore/version-bump-pending` PR touches the scout beta line
   (`--allow-pending-bump` to override); target build < beta pin build requires
   `--force` (rollback path) → rewrite `versions.ts` (site pin = v; copy beta
   image line verbatim → prod) → branch `scout-promote-<v>`, commit
   `feat(homelab): promote scout-for-lol <v> to prod`, `gh pr create` (no
   auto-merge by default; `--auto` opts in).
4. **`packages/homelab/src/cdk8s/src/versions.ts`**:
   - add `"scout-for-lol-site/prod": "unpromoted"` with
     `// not managed by renovate — promoted with scripts/promote-scout.ts (lockstep with shepherdjerred/scout-for-lol/prod)`
   - **replace the Renovate annotation** on `shepherdjerred/scout-for-lol/prod`
     (`versions.ts:140`) with the same not-managed comment — a Renovate
     digest/pin PR moving the backend alone would silently break lockstep.
5. **`.buildkite/pipeline.yml`**:
   - `sites` step: drop the two scout buckets from the loop; append
     `bun scripts/scout-site-release.ts archive --version "2.0.0-$BUILDKITE_BUILD_NUMBER"`
     and `… deploy-beta --version …` (same build cost as today).
   - new `scout-prod-reconcile` step: pod_light, main-only,
     `depends_on: [argocd-sync, sites]`,
     `concurrency_group: monorepo/site-deploys`, `concurrency: 1`, SEAWEEDFS→AWS
     cred mapping, `bun scripts/scout-site-release.ts reconcile-prod`. Backend
     deploys first by construction; usually a marker-match no-op.
   - PR dry-run step (`:401`): swap scout site loop entries for the three
     subcommands with `--dry-run`.
6. **Docs, same PR**: `packages/scout-for-lol/AGENTS.md` CI/CD section
   (archive/promote/reconcile + commands); fix the stale `version-management`
   skill claim that the pipeline was removed. Run
   `bun run verify -- --affected`.

### Phase 3 — first promotion (same day as PR 2 merge)

```bash
AWS_PROFILE=seaweedfs bun scripts/promote-scout.ts   # defaults to beta's live marker
# review PR (backend 2.0.0-4791 → ~2.0.0-578x), merge; next main build reconciles
curl -fsS https://scout-for-lol.com/.release-version  # == promoted version
```

Pre-promotion checklist (the jump is ~1000 builds):

- Diff backend required env 4791→target vs prod stage wiring
  (`resources/scout/index.ts` — beta-only AI keys `:173-194` must not be
  required in prod, or add them to prod's 1P item first).
- Confirm Prisma migrations 4791→target are forward-only (beta has run them;
  prod DB is separate).
- Until this merges, prod site stays frozen at last pre-PR-2 content (skew
  persists but doesn't worsen) — hence same-day.

**Independent quick win (outside this plan):** make `subscriptionFilterQueues`
undefined-safe (`data/src/model/subscription-filter.ts:111`, `=== null` →
`== null` + widen types) as defense-in-depth for the rollout window.

## Idempotency / failure summary

| Step           | Repeat                                       | Failure                                                                          |
| -------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| archive        | re-sync no-op                                | no manifest ⇒ version not promotable                                             |
| deploy-beta    | same as today                                | marker only written after success                                                |
| reconcile-prod | marker==pin no-op every build                | mid-sync crash retries next build; missing archive fails loudly, no partial sync |
| promote-scout  | same branch/PR refreshed                     | guards abort before edits                                                        |
| rollback       | `git revert` promotion → same reconcile path | archive must be within 365d retention                                            |

## Verification

1. PR 2 dry-run step rehearses all three subcommands on the PR itself.
2. Beta continuity: post-merge build → `curl https://beta.scout-for-lol.com/.release-version` = build version; Bugsink beta events carry the release.
3. Archive: `aws s3 ls s3://scout-site-releases/` shows `<v>/` + `<v>.json`; spot-check `index.html` for real Pinterest tag + release string (prod flavor proof).
4. Reconcile: logs show `unpromoted` sentinel pre-promotion, marker-match no-ops after.
5. E2E promotion (Phase 3): `/.release-version`, page-source release string, `kubectl -n scout-prod get deploy -o jsonpath` digest == promoted pin, ArgoCD `scout-prod` Healthy.
6. Rollback drill: revert promotion on a branch → merge → bucket + image return to prior version via the same checks.

## Risks / edge cases

- **First run**: explicit `"unpromoted"` sentinel; retired by first promotion.
- **Pending bump PR at promote time**: guard refuses (beta pin may lag a just-pushed image; pairing old backend + new site).
- **Out-of-order reconciles**: `monorepo/site-deploys` serializes; a stale-pin sync self-heals next build. Accepted residual risk, low.
- **Renovate**: annotation removal on the prod image pin is mandatory; `starlight-karma-bot` entries untouched.
- **Marker exposure**: `/.release-version` served publicly — intentional (plain-text version; doubles as probe endpoint).
- **Archive retention vs old pin**: only matters if the marker is lost AND the pin is >365d old; promotion cadence ≪ retention.
- **New bucket** `scout-site-releases`: created via reviewed tofu PR (PR 1), never auto-created by a script.
