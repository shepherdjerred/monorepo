# Generated-Code Freshness Automation

## Executive Summary

A repo-wide audit (prompted by the resume.pdf fix, PR #1560) found that four
generated artifacts have **no freshness automation** — everything else is
either hermetic codegen (Prisma et al.) or already bot-maintained by Temporal
(data-dragon, llm-catalog, READMEs, lane-priors). This plan closes all four
gaps in five small PRs, reusing the existing Temporal clone→regen→PR helpers:

1. **DPP pokeemerald data (bug fix + daily bot PR)** — the species/map tables
   are generated from a _different fork at a different frozen SHA_ than the
   wasm actually built (and Renovate silently manages only one of the two pin
   copies — the Dockerfile copy is frozen). Fix: one pin source of truth in
   `build-wasm.sh`, a config-only Renovate regex fix for the Dockerfile copy,
   generators repointed to the ottohg fork, regen appended to `build-wasm.sh`,
   plus a daily Temporal job that opens the regen PR the morning after a pin
   bump merges (hosted Renovate can't run regen itself).
2. **Helm value types (CI drift gate — user decision)** — a self-scoping
   Buildkite step runs `generate-helm-types --check` only when generator
   inputs change; helm is already in the CI image via mise. Known trade-off:
   Renovate chart-bump PRs go red until someone pushes the regen commit.
3. **cdk8s CRD imports (daily bot PR)** — time-coupled drift (cluster
   operator upgrades) that no CI gate can see; a daily Temporal job runs
   `update-imports` in-cluster (kubectl already in the worker; needs one new
   read-only ClusterRole + a pinned `cdk8s-cli` devDep) and PRs on drift.
4. **Scout showcase PNGs (weekly bot PR)** — regenerated from prod S3 against
   the curated manifest; `generatedAt`-only churn suppressed via diff
   inspection; missing S3 keys fail loudly as the re-curation signal (the
   committed manifest's keys are likely already GC'd — re-curate during
   rollout).

Also fixes four stale docs (root CLAUDE.md's false "weekly helm refresh"
claim, PATCHES.md's removed-Dagger references, two generator headers).
Estimated shape: 5 PRs, no new worker-image binaries, one RBAC addition.

## Status

In Progress

## Context

While moving `resume.pdf` out of git (PR #1560), an audit of committed generated
artifacts found that the repo's freshness automation has decayed:

- The `helm-types-weekly-refresh` Temporal schedule was deleted (#1168) in favor
  of a Dagger CI drift gate — which was itself deleted in the Buildkite
  replatform (#1516). **Helm value types now have no automation at all**, and
  root CLAUDE.md still (falsely) documents the weekly refresh.
- cdk8s CRD imports (`packages/homelab/src/cdk8s/generated/imports/`) are
  regenerated manually against the live cluster; drift is time-coupled (operator
  chart bumps via Renovate + ArgoCD sync), so no CI gate can catch it.
- discord-plays-pokemon's generated species/map tables pin
  `tripplyons/pokeemerald-wasm@ed25aa7c` while the wasm itself is built from
  `ottohg/pokeemerald-wasm@c101be5` (Renovate advances the pin) — **a live
  drift bug**: the wasm marches forward, the derived tables don't.
- scout-for-lol marketing showcase PNGs are regenerated manually from prod S3
  content; nothing keeps them current with report-renderer changes.

User decisions (2026-07-19):

1. CRD imports → Temporal scheduled refresh, **daily**, opening a PR on drift
   (time drift, not code drift — CI gates can't see it).
2. DPP: fix the two-refs bug; regeneration can fold into the `build-wasm.sh`
   flow. **Constraint: hosted (Mend) Renovate cannot run postUpgradeTasks**, so
   regen can never ride the Renovate pin-bump PR itself.
3. Showcase PNGs → **weekly** schedule (new or added to an existing one)
   opening a PR with regenerated images.
4. Audit must be complete: every generated artifact identified and explicitly
   dispositioned (e.g. Prisma is fine as-is), even where no change is needed.
5. General preference: scheduled auto-gen (bot PR) over fail-in-CI drift gates
   where both could work.

## Resolved decisions (user, 2026-07-19)

- **Helm types → CI drift gate only** (user chose this over the Temporal
  refresh, aware that Renovate chart-bump PRs touching `versions.ts` will fail
  the gate until someone pushes the regen commit — the `--check` failure output
  prints the fix command). Requires helm in the CI image; worker image does NOT
  need helm.
- **CRD imports → Temporal daily refresh** (job 1 is now CRD-imports-only).
- **DPP → Temporal daily refresh** + Renovate regex fix for the unmanaged
  Dockerfile pin copy + generators repointed to ottohg reading the pin from
  build-wasm.sh + generators appended to build-wasm.sh for the manual path.
- **Showcase → dedicated weekly schedule** (staggered Mon ~10:00 PT), with
  `generatedAt`-only diffs treated as no-drift (or equivalent — design agent
  picks the mechanism).

## Exploration (in flight)

- Agent A: full repo inventory of generated artifacts + existing automation.
- Agent B: DONE — findings below.
- Agent C: deep-dives — DPP pins/generators/build-wasm, helm-types generator +
  old drift gate mechanics, showcase generator inputs/outputs/nondeterminism.

### Agent B findings — Temporal refresh→PR infrastructure (confirmed)

- **Canonical pattern** (readme-refresh, llm-catalog-refresh, data-dragon,
  scout-season-refresh all share it): activity clones monorepo to /tmp
  (shallow/blobless) → regenerates → path-scoped `git status --porcelain`
  drift check → prettier → `openSeasonRefreshPr(...)` (git push
  --force-with-lease + `gh pr create`, GitHub App installation token via
  `createGitHubAppInstallationToken()`, hooks disarmed via
  `disarmGitHooks`).
- **Key reusable modules**:
  - `packages/temporal/src/activities/scout-season-refresh-git.ts` —
    `openSeasonRefreshPr`, `runCommand`, `writeGitAskpass`,
    `changedFilesInPaths`, `getUnifiedDiff`.
  - `packages/temporal/src/activities/bot-clone.ts` —
    `rootInstallWithoutHooks`, `disarmGitHooks`, `botCloneCacheDir`,
    `installScoutWorkspace`, `buildLlmModels`.
  - `packages/temporal/src/lib/github-app-token.ts`.
  - Rehearsal: `packages/temporal/scripts/rehearse-bot-clone.ts`
    (`check:rehearsal` turbo task) must be extended for new clone deps.
- **Adding a schedule**: (a) activity module + spread into
  `src/activities/index.ts`; (b) thin workflow + wrapper export in
  `src/workflows/index.ts`; (c) `SCHEDULES` entry in
  `src/schedules/register-schedules.ts` (id, workflowType, args,
  cronExpression in America/Los_Angeles, taskQueue DEFAULT, overlap SKIP,
  memo, timeout, catchupWindow); (d) new CLI tools → `packages/temporal/Dockerfile`;
  (e) remove id from `DELETED_SCHEDULE_IDS` if resurrecting one.
  Weekly PR-opening jobs staggered Mon 07/08/09 PT; the old helm-types slot
  Mon 06:00 PT is free.
- **Old helm-types workflow recovered** (`git show 2542886c1^:...`): activity
  `refreshHelmTypes()` = depth-1 clone → install → build eslint-config +
  helm-types → `bun run generate-helm-types` in cdk8s pkg → drift on
  `generated/helm` → PR. Workflow timeouts 20min/60s heartbeat. Schedule id
  `helm-types-weekly-refresh` sits in `DELETED_SCHEDULE_IDS` today.
- **Worker image gaps**: image (packages/temporal/Dockerfile, oven/bun base)
  has git, gh, kubectl, curl, cog, claude, codex, tofu, argocd, etc. but
  **NO helm** (removed with the old workflow — must re-add) and **no cdk8s
  CLI** (needed for `cdk8s import`; update-imports.ts spawns `cdk8s`).
- **k8s access**: worker runs in-cluster with SA `temporal-worker`; kubectl
  precedent exists (zfs-maintenance, bugsink, velero-orphan-audit). RBAC via
  `audit-rbac.ts` / `worker.ts` — **does NOT currently grant
  `customresourcedefinitions` read** (apiextensions.k8s.io); must add for
  `kubectl get crds`.
- **Worker has AWS/S3 (SeaweedFS) creds** already mounted from 1Password —
  relevant for the showcase job (verify scout's bucket is reachable with
  them via Agent C).
- Activities run in-process (no sandbox) and freely Bun.spawn subprocesses;
  only workflows are sandboxed. Observability-heavy helpers must live in
  `src/shared/` to stay out of the workflow webpack bundle.

## Complete generated-artifact audit (Agent A) — dispositions

Every generated artifact in the repo, with its freshness story and whether this
plan changes it. "OK as-is" = identified, discussed, no action.

| Artifact                                                                                    | Freshness today                                                                   | Disposition                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| homelab `generated/helm/*.types.ts`                                                         | **NONE** (schedule deleted #1168, CI gate lost #1516)                             | **FIX — this plan** (Temporal daily refresh)                       |
| homelab `generated/imports/*` (CRDs, live cluster)                                          | **NONE** (manual)                                                                 | **FIX — this plan** (same Temporal daily refresh)                  |
| dpp `generated/species.ts` + `map-names.ts`                                                 | **NONE** + wrong-fork pin bug                                                     | **FIX — this plan**                                                |
| scout showcase PNGs + `scout-showcase-assets.json`                                          | **NONE** (manual, live S3)                                                        | **FIX — this plan** (Temporal weekly)                              |
| scout data-dragon assets + `champion-name-overrides.generated.ts` + changelog append        | Temporal `scout-data-dragon-*` (daily check + weekly refresh, PRs)                | OK as-is                                                           |
| scout `lane-priors*.generated.json` (live S3)                                               | Temporal (piggybacks data-dragon activity `GENERATED_PATHS`)                      | OK as-is                                                           |
| `packages/llm-models/src/catalog.json`                                                      | Temporal `llm-catalog-refresh-weekly` (PR)                                        | OK as-is                                                           |
| Root/sandbox READMEs (cog tables)                                                           | Temporal `readme-refresh-weekly` (PR)                                             | OK as-is                                                           |
| Prisma clients (scout, birmel, discord-plays-mario-kart)                                    | gitignored; `turbo run generate` in default chain                                 | OK as-is (hermetic, never committed)                               |
| scout `template.db` (committed)                                                             | `generate-check` turbo task (`check-test-template-db.ts`) — an in-repo drift gate | OK as-is (good precedent for committed hermetic artifacts)         |
| temporal `ha-schema.ts` (live HA) / committed stub                                          | gitignored + committed safe stub; `generate:live`                                 | OK as-is                                                           |
| scout favicons (from `favicon.svg`, needs rsvg/magick)                                      | manual, hermetic                                                                  | OK as-is (changes only with the SVG; noted, low value to automate) |
| resume.pdf                                                                                  | Fixed in PR #1560 (CI artifact)                                                   | done                                                               |
| report-lake parquet, webring TypeDoc, wasm binaries, cooklang plugin bundles, fonts patcher | build outputs / in-app derived, gitignored                                        | OK as-is (not source codegen)                                      |
| sandbox/archive generated dirs                                                              | frozen legacy                                                                     | out of scope                                                       |

Notable inventory facts:

- No committed generated artifact has any CI freshness step today; all
  automation is Temporal-schedule-driven or manual.
- `.buildkite/pipeline.yml` has no codegen step at all.
- The `generate-check` pattern (scout template.db) already exists for
  gate-style verification of a committed hermetic artifact.

## Plan

One PR per phase. Phases 0/1 are standalone; 2–4 each add one Temporal job;
5 rides along with each phase's PR (docs land with the code they describe).

### Phase 0 — DPP pin unification + Renovate fix + stale docs

| File                                                                  | Change                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/discord-plays-pokemon/scripts/lib/pokeemerald-pin.ts` (new) | `readOttohgSha()` — parses `OTTOHG_SHA="<40hex>"` out of `build-wasm.sh`; throws if absent. Single pin source of truth.                                                                                                                                                                                    |
| `scripts/generate-species-data.ts`, `scripts/generate-map-names.ts`   | Repoint from `tripplyons@ed25aa7c` to `ottohg/pokeemerald-wasm@readOttohgSha()` (all 4 fetched paths verified identical in ottohg at the current pin). Fix both stale header comments (real outputs are `packages/backend/src/game/events/generated/species.ts` and `.../spatial/generated/map-names.ts`). |
| `scripts/build-wasm.sh`                                               | Append both generator invocations after the wasm copy, so the manual upgrade path regenerates data in the same run.                                                                                                                                                                                        |
| `renovate.json` (pokeemerald manager, ~line 37)                       | Add `packages/discord-plays-pokemon/Dockerfile` to `managerFilePatterns` + a second matchString for the unquoted `ENV OTTOHG_SHA=` form. Validate with `bunx renovate-config-validator`.                                                                                                                   |
| `packages/discord-plays-pokemon/Dockerfile` (~line 24)                | Add the `# renovate: datasource=git-refs depName=pokeemerald-source branch=master` annotation line above the `ENV`.                                                                                                                                                                                        |
| `wasm-src/PATCHES.md`                                                 | Rewrite Pin/Updating sections: source of truth is `build-wasm.sh` `OTTOHG_SHA`; drop references to removed `.dagger/src/constants.ts` + `buildPokeemeraldWasm`.                                                                                                                                            |
| —                                                                     | Run both generators once; commit any real diff here so the daily job starts clean.                                                                                                                                                                                                                         |

### Phase 1 — Buildkite helm-types drift gate

- New step `helm-types-drift-check` in `.buildkite/pipeline.yml` (uses `*pod`;
  helm already present via `.mise.toml` `helm = "3"` → no CI-image change):
  - PR-only (`if: build.branch != pipeline.default_branch`); self-scopes with
    `git merge-base origin/main HEAD` + `git diff --quiet` over
    `packages/homelab/src/cdk8s/src/versions.ts`, the generate/parse scripts,
    `packages/homelab/src/helm-types`, and `generated/helm` itself (catches
    hand-edits); exits 0 when untouched.
  - On trigger: `bun install --frozen-lockfile` → build eslint-config +
    helm-types via turbo → `cd packages/homelab/src/cdk8s && bun run
generate-helm-types --check`.
  - **Accepted consequence**: Renovate chart bumps touching `versions.ts` fail
    the gate until someone pushes the regen commit (`--check` output prints the
    command). Hosted Renovate cannot do it itself.
- Update the stale header in `generate-helm-types.ts` ("run manually now that
  CI is removed" → names the new step).

### Phase 2 — Temporal daily: homelab CRD imports (`homelab-crd-imports-daily`)

- `packages/homelab/src/cdk8s/package.json`: add exact-pinned `cdk8s-cli`
  devDep (today the bare `cdk8s` spawn only works with a global install).
  Verify the isolated linker exposes `node_modules/.bin/cdk8s`; fallback is
  `bunx cdk8s` inside the script.
- `update-imports.ts`: fix stale `rm -rf imports` → wipe `generated/imports`
  (so deleted CRDs don't leave stale files); header comment names the schedule.
- New activity `packages/temporal/src/activities/homelab-crd-imports-refresh.ts`
  modeled on the recovered helm-types activity: depth-1 clone →
  `rootInstallWithoutHooks` → `bun run update-imports` (cwd cdk8s pkg) →
  `changedFilesInPaths(["packages/homelab/src/cdk8s/generated/imports"])` →
  no-diff or `openSeasonRefreshPr` (branch `chore/crd-imports-refresh-<id8>`).
  No prettier pass — `**/generated/**` is prettier-ignored.
- Wiring: spread into `src/activities/index.ts`; thin workflow
  `runHomelabCrdImportsRefresh` (20m startToClose / 60s heartbeat / 2
  attempts); wrapper export in `src/workflows/index.ts`; `SCHEDULES` entry
  cron `30 5 * * *` PT, DEFAULT queue, SKIP, 45m execution timeout.
  `helm-types-weekly-refresh` stays in `DELETED_SCHEDULE_IDS`.
- RBAC (`packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`): new
  ClusterRole `temporal-worker-crd-reader` (apiextensions.k8s.io /
  customresourcedefinitions / get,list) + binding, mirroring
  `temporal-worker-ingress-reader`. No worker-image changes (kubectl baked;
  cdk8s comes from the clone).

### Phase 3 — Temporal daily: DPP pokeemerald data (`dpp-pokeemerald-data-daily`)

- New activity `dpp-pokeemerald-data-refresh.ts`: depth-1 clone →
  `rootInstallWithoutHooks` → run both generators (cwd
  `packages/discord-plays-pokemon`) → drift check on the two generated files →
  PR `chore/dpp-pokeemerald-data-refresh-<id8>`. Steady state is no-diff; its
  purpose is the follow-up regen PR the morning after a Renovate pin bump
  merges.
- Thin workflow `runPokeemeraldDataRefresh` (10m/60s/2); schedule cron
  `30 4 * * *` PT, 30m execution timeout. Old `pokeemerald-wasm-*` ids stay
  deleted.

### Phase 4 — Temporal weekly: scout showcase (`scout-showcase-refresh-weekly`)

- New activity `scout-showcase-refresh.ts`: depth-1 clone →
  `rootInstallWithoutHooks` → `installScoutWorkspace` → run
  `scripts/generate-marketing-showcase.ts` with in-clone absolute
  `--manifest/--out/--asset-index`, `--bucket scout-prod`, env passthrough
  `AWS_ACCESS_KEY_ID/SECRET/REGION` + `AWS_ENDPOINT_URL_S3=$S3_ENDPOINT`
  (fail fast if unset; SDK v3 honors it natively; lane-priors precedent).
- `generatedAt` churn: diff-inspection suppression — if the only change is
  `scout-showcase-assets.json` and every changed line matches
  `/"generatedAt":/` (`isGeneratedAtOnlyDiff` helper + unit tests, precedent
  `shouldCreateDataDragonPr`'s image-only suppression), outcome
  `timestamp-only-no-pr`. Real drift PRs keep the honest fresh timestamp.
- Missing S3 `imageKey` (NoSuchKey) stays fail-loud; schedule memo + error
  message carry the runbook: re-curate the manifest via
  `discover-marketing-showcase.ts`.
- Thin workflow `runScoutShowcaseRefresh` (25m/60s/2); schedule cron
  `0 10 * * 1` PT (continues the Mon 07/08/09 stagger), 60m timeout. Branch
  `chore/scout-showcase-refresh-<id8>`.

### Phase 5 — Rehearsal + docs (folded into the phases above)

- `packages/temporal/scripts/rehearse-bot-clone.ts`: new legs — assert
  `cdk8s` bin exists post-install; parse the pin + assert DPP generator/output
  paths; assert showcase manifest + script paths.
- Worker Dockerfile + smoke.ts deliberately unchanged (no new binaries) —
  stated explicitly so nobody re-adds helm to the worker image.
- Docs: root `CLAUDE.md` helm paragraph rewritten (drift gate + CRD daily
  schedule); `packages/temporal/CLAUDE.md` gains the three schedules;
  `packages/discord-plays-pokemon/AGENTS.md` "Generated data" section;
  scout AGENTS.md showcase runbook; retention-plan interaction note in
  `packages/docs/plans/2026-07-03_scout-s3-image-retention.md`; plan mirrored
  to `packages/docs/plans/2026-07-19_generated-code-freshness-automation.md`.

## Verification

- **Phase 0**: run both generators → expect byte-identical output (verified
  upstream parity); `renovate-config-validator`; `bun run verify -- --affected`.
- **Phase 1**: local `bun run generate-helm-types --check` green on clean tree;
  hand-edit a `generated/helm` file → check fails with fix command; scratch-
  branch test of the diff-scoping expression; step skips on an untouched PR.
- **Phase 2**: with live kubecontext, `bun run update-imports` → clean status
  or real CRD churn; confirm `cdk8s` resolves via the devDep;
  `kubectl auth can-i list customresourcedefinitions --as=system:serviceaccount:temporal:temporal-worker`
  post-deploy.
- **Phase 3/4**: temporal pkg `bun test` (bundle smoke), `check:rehearsal`,
  `smoke` (image + worker boot). Showcase: one laptop run against scout-prod
  first — validates the generatedAt-only suppression against reality AND
  whether the manifest's S3 keys still exist.
- **Post-deploy (all)**: `temporal schedule list`; manual
  `temporal schedule trigger --schedule-id <id>` per job; check run outcome
  payloads (`no-diff` / `pr-created` / `timestamp-only-no-pr`) in the UI;
  `temporal_schedule_orphans` stays 0; drift PRs green in Buildkite.

## Risks

- **Showcase manifest keys likely already GC'd** — `scout-image-gc-daily`
  prunes `prematch/*.png` >30d and the committed manifest references
  2026-06-18 keys. First run will probably fail NoSuchKey **by design**;
  re-curate the manifest during Phase 4 rollout, before enabling the schedule.
- **cdk8s bin resolution under the isolated linker** — verify before merging
  Phase 2; fallback `bunx cdk8s`.
- **First cdk8s-cli Renovate bump** yields a large (legitimate) CRD-import
  drift PR the next morning — expected.
- **helm floats within major 3** (`.mise.toml`) — not a codegen input in
  practice; noted only.
- **PR-only gate** accepts the rare two-interacting-PRs window on main; next
  input-touching PR catches it.
