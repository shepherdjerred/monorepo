---
id: plan-2026-07-25-scout-prod-renovate-promotion
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Replace bespoke scout prod promotion with Renovate

## Remaining

- [ ] PR #1630 merged (single PR — tag minting + cutover were folded together 2026-07-25). Merging it promotes prod 2.0.0-6017/5991 → 2.0.0-6088 (the beta pair at authoring time)
- [ ] Post-merge check: `docker buildx imagetools inspect ghcr.io/shepherdjerred/scout-for-lol:2.0.0-<merge build>` resolves and matches the beta pin digest; `curl https://scout-for-lol.com/.release-version` → 2.0.0-6088
- [ ] Close the stale `scout-promote-pending` PR (#1617 or successor) and delete its branch after #1630 merges
- [ ] `chezmoi apply` after #1630 merges (version-management skill changed in dotfiles)
- [ ] Renovate PR observed for `shepherdjerred/scout-for-lol/prod` after the next beta-advancing build; merge = promotion verified via `/.release-version`

## Context

Scout-for-lol prod is promoted by a bespoke workflow: the `scout promotion PR` Buildkite step runs `scripts/promote-scout.ts --ci`, which maintains a standing `scout-promote-pending` PR moving two pins (`shepherdjerred/scout-for-lol/prod` image + `scout-for-lol-site/prod` site artifact) in lockstep. The user wants the standard Renovate model instead: beta stays auto-deployed (version commit-back, unchanged), prod becomes a normal non-automerge Renovate PR that they merge manually.

**Why Renovate can't do it today:** CI pushes images as `:$GIT_SHA` + `:latest` only — no `2.0.0-N` tags exist in GHCR for Renovate to discover (this is why the existing `starlight-karma-bot/prod` annotation has been dormant since Feb, frozen at `2.0.0-4777`). And the site artifact pin has no Renovate datasource at all. Image and site build numbers legitimately diverge (image is content-gated, site archives every scout build), so the pair must be captured explicitly.

**Core design:** mint a versioned GHCR tag as the atomic release pair. After a build archives site version `V = 2.0.0-$BUILD` and deploys it to beta, retag the paired backend digest as `ghcr.io/shepherdjerred/scout-for-lol:V`. Tag exists ⟺ site V is archived AND the tag's digest is the correct paired backend. Renovate (docker datasource, `pinDigests`) discovers tags and opens the promotion PR; the site pin is deleted — `reconcile-prod` derives the site version from the prod image pin's tag portion. Merging the Renovate PR IS the promotion. Also revive starlight's dormant annotation by pushing `2.0.0-$BUILD` tags for it (no site artifact, so a plain tag push at bake time).

User decisions (already made): include starlight ✔; rollback = `git revert` / hand-edit to an older minted tag, no helper script ✔.

## PR structure

**Shipped as ONE PR (#1630).** The plan below was originally split in two on the theory that the cutover pin must reference an already-minted tag; implementation showed that constraint is soft — the prod reconcile consumes the site _archive_ (which exists for the cutover version) and Kubernetes pulls the image by digest, so the GHCR tag is only needed for _future_ Renovate offers, and the combined PR's own merge build mints the first one. The two-PR framing below is kept for design context.

| PR  | What                                                                                           | Effect on prod                                                                               |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Tag minting (scout `tag-release` + pipeline step; starlight tag push in bake)                  | None — promote-scout still in force; tags start appearing; starlight Renovate PRs come alive |
| 2   | Cutover: Renovate annotation, delete site pin, derive in reconcile, delete promote-scout, docs | Bundles one final manual promotion to current beta pair                                      |

## PR 1 — mint versioned tags

- **`scripts/scout-site-release.ts`** — new `tag-release --version 2.0.0-<build> [--digest sha256:…] [--dry-run]` subcommand:
  - Validate against existing `VERSION_PATTERN`; assert archive manifest `s3://scout-site-releases/<v>.json` exists (reuse `assertArchived` head-object pattern from promote-scout.ts:113-136). If `--digest` given but manifest missing → fail loudly (lane-gap signal).
  - Digest: `--digest` (this build's fresh push, from meta-data) if present; else the committed `versions["shepherdjerred/scout-for-lol/beta"]` digest **with a staleness guard**: `docker buildx imagetools inspect` layer-compare pinned digest vs `:latest` (same technique as `bake-images.sh:259-263`); mismatch = commit-back not yet merged → log + exit 0 without minting (fail-safe; converges next build since the commit-back merge fires `site-scout`).
  - Mint: `docker buildx imagetools create --tag ghcr.io/shepherdjerred/scout-for-lol:<v> ghcr.io/shepherdjerred/scout-for-lol@<digest>` — daemonless, idempotent. Auth: `printf '%s' "$GH_TOKEN" | docker login ghcr.io -u shepherdjerred --password-stdin` (same as `docker-env.sh:65`; ci-base image has docker CLI + buildx). Use `run([...])` spawns (script is in validate-pipeline.ts `automationSources`).
- **`.buildkite/pipeline.yml`** — new step `scout-tag-release` (`depends_on: [images, sites]` — do NOT extend `sites`' depends_on; that would park site deploys behind the ~50-min images step). Gate: run when the build recorded a scout digest in meta-data `image-digests` OR `ci-changed.sh site-scout` fired. Replace-later note: sits where `scout-promotion` is (deleted in PR 2). Add `tag-release --dry-run` rehearsal to the `sites-pr` step (~line 869).
- **`.buildkite/scripts/ci-changed.sh`** — add `docker-bake.hcl` + `.dockerignore` to the `sites` and `site-scout` lane paths (closes the gap where a bake-config-only change alters image content without a fresh site archive to pair with).
- **`.buildkite/bake-images.sh`** — starlight: in the push loop, when the content-gate records a changed digest for `starlight-karma-bot`, also push `${REGISTRY}/starlight-karma-bot:2.0.0-${BUILDKITE_BUILD_NUMBER}` (matches what commit-back writes to its beta pin). Explicit allowlist — scout excluded (its tag must stay archive-gated in the dedicated step).

Verify after merge: `docker buildx imagetools inspect ghcr.io/shepherdjerred/scout-for-lol:2.0.0-<build>` resolves and digest matches the beta pin / meta-data digest; anonymous tags/list shows it (Renovate visibility — package is public, no hostRules needed).

## PR 2 — cutover

- **`packages/homelab/src/cdk8s/src/versions.ts`**
  - Prod pin (lines ~155-160): replace the "not managed by renovate" comment block with the annotation (same proven shape as starlight's line 170):
    `// renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol`
  - Set pin value to the newest minted tag + digest (current beta pair) — this is the bundled final promotion; also fixes the site regression (site pin 6017 > image pin 5991, so deriving from the old image tag would roll the site back).
  - Delete `"scout-for-lol-site/prod"` + comment (lines ~161-166); scrub promote-scout mention from the `/beta` comment.
- **`scripts/scout-site-release.ts`** — `reconcileProd`: `const pin = versions["shepherdjerred/scout-for-lol/prod"].split("@")[0]`, throw if not `VERSION_PATTERN`; drop the `unpromoted` sentinel branch/constant; update header comment (promotion = merge Renovate PR).
- **Delete `scripts/promote-scout.ts`** and references:
  - pipeline: `scout-promotion` step (lines ~1176-1194), `promote-scout.ts` in `sites-pr` `if_changed` (~854) and its `--dry-run` rehearsal (~869)
  - `ci-changed.sh`: `scout-promotion` lane (~184-194)
  - `validate-pipeline.ts`: `"scout-promotion"` in the lane loop (~203)
  - Manually close any open `scout-promote-pending` PR + delete branch (the self-closing step is gone).
- **`renovate.json`** — no functional change ("Prod images" rule at lines 113-121 already gives scout `automerge: false`, `minimumReleaseAge: 0`, `schedule: at any time`); update the rule description to say it's now the promotion mechanism.
- **Docs**
  - `packages/scout-for-lol/AGENTS.md` §Stage deploys (~130-137): promotion = merge the Renovate PR; site version derived from the image tag; invert the line-136 "never via Renovate" prohibition (hand-edits to non-minted tags stay prohibited). `CLAUDE.md` is a symlink — no separate edit.
  - `packages/dotfiles/dot_agents/skills/version-management/SKILL.md` (~186-208 "Scout prod is promoted, not bumped"): rewrite; per dual-edit rule also update the live copy at `~/.claude/skills/version-management/SKILL.md`.
  - `packages/docs/archive/superseded/2026-07-19_scout-lockstep-stage-deploys.md`: mark superseded (frontmatter) with pointer; fix the passing mention in `2026-07-19_bugsink-triage-followups.md`.

## Renovate versioning: `semver`

`2.0.0-N` is a prerelease of `2.0.0`; numeric prerelease identifiers compare numerically (6100 > 6017 across digit counts). Renovate's default `ignoreUnstable` permits prerelease→prerelease when current is a prerelease of the same `major.minor.patch` — always true here (`VERSION_PATTERN` hardcodes `2.0.0-`). Regex versioning can't be expressed in the annotation line (custom-manager group is `[a-z-]+`). Caveat to note in the comment: if the release base ever leaves `2.0.0`, one manual pin edit is needed. `pinDigests: true` keeps `tag@digest`; minted tags are never re-pushed, so no digest-churn PRs. Renovate keeps one standing PR updated in place as beta advances — same UX as the old standing promotion PR.

## Window analysis / safety

- Between PRs: promote-scout still runs — harmless either way.
- PR 2 changes pin + derivation atomically in one commit; `scout-prod-reconcile` runs after `argocd-sync` (safe skew direction: old-frontend/new-backend, unchanged from today).
- No orderable state lets reconcile derive a version without an archive: every Renovate-offerable tag was minted only after its manifest existed. Expired archives (365-day lifecycle) → reconcile throws loudly before touching prod, same as today.

## Rollback (post-cutover)

`git revert` the Renovate merge (one pin, both halves atomic) — ArgoCD rolls backend back, next reconcile re-syncs the older archive. Or hand-edit the pin to any older **minted** tag@digest. No helper script.

## Verification

1. PR 1 merge → tag appears in GHCR; digest matches pair; `sites-pr` rehearsal proved daemonless imagetools in pod_light (if it fails there, fallback: ~40-line Bun registry-API manifest copy).
2. PR 2 merge → Dependency Dashboard lists the dep; after next beta-advancing build, Renovate PR appears (`2.0.0-A@sha → 2.0.0-B@sha`).
3. Merge the Renovate PR → pod image digest updates via ArgoCD; `curl https://scout-for-lol.com/.release-version` equals the promoted tag and matches beta's value as of that build. Starlight: Renovate PR appears for its prod pin once a content-changed build pushes a tag.
4. `bun run verify -- --affected` green on both PRs.

## Session Log — 2026-07-25

### Done

- PR 1 [#1630](https://github.com/shepherdjerred/monorepo/pull/1630) (`feature/scout-renovate-promotion`): `tag-release` subcommand in `scripts/scout-site-release.ts` (archive-gated mint of `ghcr.io/shepherdjerred/scout-for-lol:2.0.0-<build>` with a rootfs-layer content-currency guard on the beta-pin fallback), `scout-tag-release` pipeline step, `docker-bake.hcl`/`.dockerignore` added to the `sites`/`site-scout` lanes, versioned starlight tag push in `bake-images.sh`, `sites-pr` dry-run rehearsal.
- PR 2 [#1632](https://github.com/shepherdjerred/monorepo/pull/1632) (draft, stacked): Renovate annotation restored on `shepherdjerred/scout-for-lol/prod` (cutover value = beta pair `2.0.0-6088`), `scout-for-lol-site/prod` pin deleted (reconcile derives the site version from the image pin's tag), `scripts/promote-scout.ts` + `scout-promotion` step/lane/tests/validator entry deleted, scout AGENTS.md + version-management skill rewritten (live `~/.agents/skills` copy synced), lockstep plan archived to `archive/superseded/` with path refs fixed, renovate.json rule description updated.
- `bun run verify -- --affected` green on both branches; pre-commit hooks passed on both commits.

### Remaining

- See `## Remaining` above (post-merge verification: first minted tag, Renovate PR appearing, promotion via merge, closing stale #1617, `chezmoi apply`).

### Caveats

- The `2.0.0-6088` GHCR tag does not exist yet (tags mint only from PR 1's merge build onward) — merging #1632 is still safe because reconcile needs the site archive (which exists), not the tag; the pin's digest handles the image pull. Renovate offers the first minted tag as soon as one exists.
- Renovate `versioning=semver` orders `2.0.0-<n>` prereleases numerically and permits prerelease→prerelease bumps only within `2.0.0`; if the release base ever moves off `2.0.0-`, the pin needs one manual edit (noted in versions.ts).
- The staleness guard skips minting for a build when the committed beta pin is content-stale vs `:latest` (pending commit-back); that build's version is simply never promotable — converges next build.

### Addendum — folded to one PR (2026-07-25)

Per user feedback, the two stacked PRs were collapsed: `git-spice branch fold` merged `feature/scout-renovate-cutover` into `feature/scout-renovate-promotion`, PR #1632 was closed (branch deleted), and #1630 now carries the whole change — tag minting, Renovate cutover, promote-scout removal, and docs. Merging #1630 is itself the first promotion (→ 2.0.0-6088).
