# Bun Workspace Setup Investigation

## Status

Complete

## Question

How is the Bun "workspace" actually set up in this monorepo? (It's non-standard.)

## Findings

### The root is NOT a Bun workspace

Despite docs calling this a "Bun workspaces monorepo," the root `package.json` has **no
`workspaces` field**. It holds only repo-level scripts and a handful of dev tools
(knip, markdownlint, prettier). The root `bun.lock` covers only those root devDeps.

### Each package is an independent install root

- ~28 packages under `packages/` (plus `scripts/ci` and `.dagger`) each have their own
  `bun.lock` and `node_modules`, installed with their own `bun install --frozen-lockfile`.
- Cross-package dependencies use **`file:../<pkg>` links**, not `workspace:*`. The graph
  is shallow: most edges are just `@shepherdjerred/eslint-config` (devDep); real runtime
  chains are depth 1–2 (e.g. `streambot → discord-video-stream`,
  `tasknotes-server → tasknotes-types`, `sjer.red → astro-opengraph-images/webring`).
- `file:` does a **copy-on-install** (no symlinks) — editing an upstream package does not
  propagate until the dependent re-runs `bun install`.

### Three packages ARE nested Bun workspaces internally

`scout-for-lol`, `discord-plays-pokemon`, and `discord-plays-mario-kart` declare
`workspaces: ["packages/*"]` in their own `package.json` — but their internal members
still link via `file:` paths, not `workspace:*`.

### Task running is hand-rolled

- `bun run build|test|typecheck|lint` at root → `scripts/run-package-script.ts`, a
  serial walker over `packages/**/package.json` that runs the named script wherever it
  exists (skips `node_modules`/`dist`/`build`/`examples`; honors `SKIP_PACKAGES`).
- No `bun --filter`, no topo ordering, no caching locally. Affected-detection + caching
  live in CI (Dagger + `scripts/ci/src/change-detection.ts`).

### History

Commit `d5405d580` (2026-03-28, "misc(root): checkpoint") removed the root
`workspaces` globs (`packages/*`, `packages/*/packages/*`, `packages/*/src/*`,
`packages/*/*`), deleted the 8,933-line root `bun.lock`, and moved root
`patchedDependencies` down into per-package `patches/`. This landed during the
Bazel→Dagger migration era.

### Recorded rationale (from past sessions via `toolkit recall`)

- **CI/production parity**: a `file:` copy-on-install means local dev is exactly what a
  clean CI/Dagger install produces — no "works via symlink locally" divergence.
- **Isolation**: each package builds/deploys as a self-contained unit; no hoisting means
  no shared dependency graph coupling unrelated packages (multiple Astro/React majors
  coexist without `overrides`).
- Migrating `file:` → `workspace:*` was **explicitly and permanently rejected** by Jerred
  in a prior session.

### Machinery that keeps the design honest

- `scripts/check-bun-lock-drift.ts` — the drift gate. Per-package
  `bun install --frozen-lockfile --dry-run` over the reverse `file:`-dep closure
  (nested-workspace-aware). Built after PR #1213 where bumping `llm-observability`
  left `discord-plays-pokemon/bun.lock` stale.
- `scripts/guard-no-package-exclusions.ts` (`bun run guard:migration`) — forbids
  `!packages/...` exclusions and compliance-check exemption branching.
- `scripts/setup.ts` phase 2 — root install + batched per-package installs with retry
  (concurrent installs contend on the shared bun cache).
- PR #1400 (`f36643fed`, branch `fix/bun-retry-drop-cleanup`, **not yet on local main**)
  pins `linker = "hoisted"` in bunfig.toml for the three nested-workspace packages —
  bun ≥1.3 auto-selects the isolated linker for configVersion-1 lockfiles, which has an
  EEXIST race when several members reference the same `file:` dep (oven-sh/bun#12917).

## Follow-up: could the underlying issues be fixed to adopt Bun workspaces?

Jerred explicitly reopened the previously-firm "never workspace:*" decision. Assessment:

- **Parity/phantom-deps rationale** — solvable. Bun 1.3 isolated linker gives stricter
  resolution than `file:` copies; blocked short-term by the EEXIST race (oven-sh/bun#12917,
  #20142) that PR #1400 works around → migrate hoisted, flip to isolated when fixed upstream.
- **Version-independence rationale** — mostly a non-issue. Workspaces don't force
  unification (nested copies per package); catalogs improve deliberate sharing.
- **Dagger cache isolation** — the real structural cost. One root `bun.lock` means any dep
  bump invalidates every package's install layer (today: only the touched package +
  dependents rebuild, via per-package Directory params in `.dagger/src/base.ts`).
  Candidate fixes: accept blast radius (bad), `bun install --filter` (same key, cheaper),
  or **per-package lockfile subsetting** (turbo-prune-style, possibly custom) — derived
  per-package lockfiles from one source of truth, keeping narrow cache keys while making
  drift structurally impossible.
- **Deleted by migration**: check-bun-lock-drift.ts, setup.ts per-package install loop,
  the `file:` EEXIST flake family behind BUN_INSTALL_WITH_RETRY, eslint-config staleness
  across 23 dependents, Renovate reverse-closure fan-out, nested-workspace linker trap.
- **Open verifications**: turbo prune text-bun.lock support; `--filter` +
  `--frozen-lockfile` semantics with only manifests mounted; bun.lock merge-conflict
  auto-resolution; BUILD_TIME_DEPS pre-build ordering unchanged.
- **Suggested Phase 0**: scratch-branch e2e PoC converting tasknotes-types,
  tasknotes-server, and discord-plays-pokemon + a lockfile-subsetting spike against
  bunBaseContainer, before any full migration plan.
- If adopted: update the decision record and the memory note recording the old
  "never workspace:*" constraint.

## Phase-0 experiments (worktree `bun-workspace-poc`, branch `feature/bun-workspace-poc`)

All run against origin/main (f36643fed) with bun 1.3.14, hoisted linker pinned at root.

| # | Experiment | Result |
|---|---|---|
| A1 | Root workspace: eslint-config + tasknotes pair, `workspace:*` | ✅ install 1.6s, typecheck/test/lint green (178/178 tests) |
| A2 | Flatten dpp nested workspace + 5 dep packages | ✅ install 8.4s cold; all 3 members typecheck after building llm-models + dvs |
| A3 | Coexistence: non-member (`llm-models`) installs w/ own lockfile | ✅ unaffected by root workspaces; incremental migration viable |
| B | `bun install --filter <pkg> --frozen-lockfile` from root lockfile | ✅ 407 vs 552 pkgs; skips other members' natives; typecheck green |
| C | Isolated linker + `globalStore=true` | ⚠️ warm wipe 1.47s vs 3.5s hoisted; BUT tasknotes-server typecheck breaks (`c.res.status` — Response type resolves differently); hoisted green |
| D | `turbo prune` (2.10.3) vs text bun.lock | ✅ with caveat: pruned lockfile byte-identical under unrelated dep bump (cache-key claim validated); handles nested members + hoists overrides/trustedDependencies; ❌ mixed `file:` edge → "Duplicate package path" corrupt lockfile; ✅ all-`workspace:*` shape installs frozen |
| E | bun auto-resolves conflicted bun.lock | ✅ `bun install` on conflict-markered lockfile resolves both branches' bumps correctly |

### Migration findings (beyond the table)

- dpp's `overrides` + `trustedDependencies` are root-only: must move to root as a **union across all members** (incl. dvs's `node-datachannel`).
- Built shared packages (llm-models, dvs, eslint-config) still need `dist/` before dependents typecheck — same BUILD_TIME_DEPS ordering as today, but build-once-symlink-everywhere replaces copy-per-consumer.
- Switching linker rewrites bun.lock (+2.5k lines) — linker choice is baked into lockfile format; pin it in root bunfig.toml.
- dpp's own `bun run --filter '*'` scripts assume it is its own workspace root; they need rescoping after flattening.
- turbo prune needs `"packageManager": "bun@x"` in root package.json.
- Isolated-linker type resolution differs from hoisted (Experiment C) — adopt hoisted first; treat isolated as a separate later migration with per-package typecheck validation.

### Dagger integration architecture (the load-bearing conclusion)

Run prune **inside Dagger** as a cheap always-runs step; mount only its output into
the install/build/test chain. Dagger content-addresses inputs, so a byte-identical
pruned lockfile keeps downstream layers warm. Validated: unrelated dep bump changed
root bun.lock but left the pruned output byte-identical (sha 58da88189a75c9f1).
Guard the pruner with a per-package `bun install --frozen-lockfile --dry-run` gate
(drift-gate pattern reborn) since turbo's bun.lock pruning is young.

### SUPERSEDING FINDING: bun-only install-firewall — no turbo needed

Jerred challenged taking a whole dep for "something so simple." Tested the
alternative: don't subset the lockfile, subset the **install output**.

- Firewall step: `bun install --filter <pkg> --frozen-lockfile` (wide cache key,
  re-runs on any root-lockfile change, ~0.3–1s warm) → export node_modules tree.
- Downstream build/test layers key on the **output Directory**, which Dagger
  content-addresses → warm when bytes are identical.
- Validated: filtered-install output tree (files + symlink targets hashed) is
  byte-identical across (1) repeat runs and (2) an unrelated package's dep change
  that rewrote the root lockfile. Hash `94c50a83dd59be4e` all three times.
- Pure bun; nothing new to maintain; no lockfile re-emission semantics at all.
- Open validation: packages with native postinstalls (node-av, sharp,
  @lng2004/node-datachannel in dpp) — postinstalls re-run in the firewall step per
  lockfile change (minutes, those packages only), and compiled `.node` outputs may
  embed timestamps/paths → possibly not byte-identical → those packages' downstream
  layers might not stay warm. Validate per-package; special-case if needed.
- turbo prune remains the fallback if native-output determinism fails (it avoids
  re-running the install entirely); custom subsetter demoted to last resort.

### turbo-for-bun risk assessment (issue-tracker evidence, 2026-07-04) — superseded by the above, kept for the record

- vercel/turborepo closed 8+ "prune emits invalid bun.lock" bugs Feb–May 2026
  (phantom entries, semver-range violations, 2.8.16 regression, --docker failures).
  All fixed within weeks — actively maintained but the youngest package-manager target.
- Bun 1.4 bumps lockfileVersion to 2; turbo compat landed 2026-06-23. Consequence:
  **bun upgrades must wait for turbo lockfile compat** — add bun to the notify-only
  version-pin pattern (like talos/kubernetes) if turbo prune is adopted; stay on
  bun 1.3.x through any migration.
- Scope containment: turbo is used ONLY as a lockfile pruner inside a Dagger step for
  JS packages — never as task runner/orchestrator (Dagger stays the polyglot graph).
  Wrapped behind `scripts/prune-lockfile.ts`; fallback ladder = custom subsetter →
  revert to per-package lockfiles.
- Our mixed-`file:`-edge duplicate-package-path bug is unreported upstream — file it.

## Session Log — 2026-07-04

### Done

- Documented the current non-standard setup (no root workspace, per-package lockfiles,
  `file:` links, drift gate) + recorded rationale + history (commit `d5405d580`).
- Assessed reopening the `workspace:*` decision; checked Bun releases since (1.3.11–1.3.14)
  and the still-open isolated-linker EEXIST issues.
- Ran Phase-0 experiments A1/A2/A3/B/C/D/E in worktree `bun-workspace-poc` (results table above).
- Pivoted architecture after Jerred pushed back on the turbo dep: validated the
  **bun-only install-firewall** (filtered-install output byte-determinism, incl.
  native-heavy dpp backend across 3 fresh installs + unrelated dep bumps).
- Wrote migration plan: `packages/docs/plans/2026-07-04_bun-workspace-migration.md`.

### Remaining

- Phase-0 leftovers (see plan): Dagger content-addressing e2e (needs memory headroom or
  Buildkite), patchedDependencies under root workspace, npm-publish `workspace:*`
  rewriting, scout (Prisma/Tauri), Astro apps, `--filter` script rescoping, knip/lefthook.
- File the turbo-prune mixed-`file:`-edge bug upstream (duplicate package path) — optional
  since turbo is now only a fallback.
- Decide whether to proceed to Wave 1 (PoC branch is essentially Wave 1 already, minus
  dsl/dvs polish and revert of the `ms`/`left-pad` test edits to llm-models).

### Caveats

- Worktree `bun-workspace-poc` contains deliberate test mutations: llm-models deps were
  churned (`ms` removed, `left-pad` added) purely to test lockfile stability — **revert
  before reusing the branch for real work**; `out/` (turbo prune) and `packageManager`
  field are PoC artifacts too.
- Isolated linker is a no-go for now on two independent grounds (EEXIST race, type
  resolution differences) — hoisted only.
- System was under memory pressure during experiments; Dagger e2e deliberately deferred.

## Session Log addendum — round 2 (same day)

### Done

- Cleaned PoC artifacts (llm-models churn, turbo `out/`, `packageManager` field).
- Validated: `--filter` script scoping from root; root `patchedDependencies` via `bun patch`
  (applied + byte-deterministic in filtered installs); `bun pm pack` rewrites `workspace:*`
  → real versions (publish safe).
- **Found blocker-class issue**: peer-dep split-brain under hoisted linker — vitest (^8)
  hoisted vite 8.1.3 to root while Astro builds with nested 7.3.6; single hoisted
  @tailwindcss/vite binds root vite 8 → `astro build` fails. Impossible under per-package
  installs. Reverted the Astro trio; dpp frontend real vite build green without them.
  Full analysis + options in the plan (align vite majors / reorder waves / isolated linker).
- Plan updated: validations checked off, split-brain section, new rule — **real builds
  gate every conversion** (install+tsc+astro-sync all missed this).

### Remaining

- Dagger content-addressing e2e (Buildkite or memory headroom); Prisma (birmel, then scout);
  scout Tauri; knip/lefthook; vite-peer version audit for the split-brain options.

### Caveats

- Worktree workspace set = Wave 1-ish (eslint-config, tasknotes pair, llm-models,
  llm-observability, discord-stream-lifecycle, discord-video-stream, dpp + members);
  Astro trio deliberately reverted out.

## Session Log addendum — rounds 3–4 (same day): convergence

### Done

- Simulated the web cluster (eslint-config+aoi+webring+sjer.red as sole workspace):
  single coherent vite 7.3.6, real `astro build` green (158 pages, OG images through
  workspace-linked aoi). Split-brain confirmed as a cross-version-world phenomenon.
  (Env fix: installed Playwright chromium-headless-shell locally for sjer.red's MDX build.)
- Found docs error: eslint-config labeled "(npm)" but 404s on the registry — never published.
- Measured reorg cost for hypothetical family moves: ~115 explicit path refs (lefthook 48,
  knip 32, ci catalog 10, setup.ts 10, .dagger ~12); nothing assumes flat packages/*.
- Surveyed happy-path tooling (Turbo/Nx/Lerna/Rush/Lage/Changesets/syncpack) — every
  orchestrator assumes one coherent product; repo's three tool-slots already filled
  (bun workspaces / Dagger / release-please).
- **Convergence (Jerred's insight)**: version-world clustering couples separate projects —
  cluster criterion is "one product, multiple packages". Applying it strictly: scout/dpp/dpmk
  already correct; **tasknotes is the only new cluster**; everything else = the existing
  federation, now with tested rationale instead of folklore.
- Rewrote the plan as a decision record: federation confirmed, tasknotes cluster +
  docs truth-up as the execution items, banked assets (install-firewall, isolated-linker
  watch, real-build gate lesson), explicit non-goals.

### Remaining

- Execute: tasknotes cluster PR; docs truth-up PR (CLAUDE.md "Bun workspaces monorepo" line,
  eslint-config label, vestigial patches/ cleanup); optional Temporal watch on
  oven-sh/bun#12917/#20142; remove PoC worktree when recycled.

### Caveats

- PoC worktree `bun-workspace-poc` is now in web-cluster-simulation state (NOT Wave-1 state);
  the earlier Wave-1 diff is snapshotted at the session scratchpad (`wave1-shape.patch`),
  which is session-scoped — recycle or lose it.
- The old "never workspace:*" stance is superseded in nuance: workspace:* is right WITHIN
  a product cluster (scout/dpp/dpmk/tasknotes), wrong as repo-wide policy.

## Session Log addendum — round 5 (same day): the isolated-linker resolution

Problem restated by Jerred: not just correctness — **ownership cost + performance +
the ~1M-file-copy problem**. That reframing revived the isolated linker + global store.

### Done

- EEXIST hammer on a 14-member stress workspace (dpp natives + Astro trio): **8/8 clean**,
  ~1.2s warm rematerialization, 12 copies vs ~1,378 symlinks. Parallel-install race is
  architecturally eliminated (one install root).
- Root-caused the isolated type break: **bun-types phantom-deps undici-types** →
  `Response` degrades to `{headers}` under isolated + skipLibCheck. Validated native
  workaround: `patchedDependencies` adding the dep (bun honors patched deps in
  resolution). Unfixed in latest/canary; needs upstream issue.
- Split-brain RESOLVED under isolated once sjer.red declared its real peer host
  (vite ^7.3.2). Found + fixed dvs phantom @types/node. Astro build then surfaced the
  real blocker: **webring's truncate-html (cheerio-rc12 chain)** needs an ambient
  entities that is simultaneously v2 and v4 — hoisting lottery, live bug today,
  root-cause fix = replace truncate-html.
- Plan rewritten to final target: **single workspace + isolated + globalStore**, with
  pre-migration fix list and CI design items (globalStore symlinks vs Dagger exports).

### Remaining

- File bun-types issue upstream; webring truncate-html replacement; Wave-1 conversion PR;
  CI layout decision (isolated-without-store in containers); per-package real-build gates.

### Caveats

- PoC worktree holds the working 14-member isolated workspace incl. the bun-types patch
  (patches/bun-types@1.3.14.patch) and honest-dep fixes — recycle for Wave 1.
- Determinism of install output was validated under hoisted; re-validate under
  isolated-without-globalStore for the CI path.

## Session Log addendum — round 6: Wave 0 execution begins

### Done

- Design approved by Jerred; plan status updated.
- **PR #1408**: webring truncate-html → htmlparser2@10 truncator (Wave 0 item 4, the
  sjer.red blocker + live production bomb). Parity proven via unchanged snapshots
  (9 RSS fixtures); sjer.red full astro build green against it; no dependent lockfile
  churn (htmlparser2 already present via sanitize-html). Worktree:
  `.claude/worktrees/webring-truncate-fix`, branch `fix/webring-truncate-html`.

### Remaining (Wave 0)

- File bun-types phantom-dep issue upstream (needs Jerred's OK to post publicly;
  evidence + repro in this log and the PoC worktree's patch).
- dvs `@types/node` + sjer.red `vite` devDep fixes — currently only in the PoC worktree;
  extract into a small honest-deps PR (or fold into Wave 1).
- Then Wave 1: the 14-member workspace conversion (recycle PoC worktree).

### Caveats

- Monitor PR #1408 through Buildkite CI before merging (pr-monitor skill).
