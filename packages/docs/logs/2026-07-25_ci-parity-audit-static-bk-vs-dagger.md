---
id: 2026-07-25-ci-parity-audit-static-bk-vs-dagger
type: log
status: in-progress
board: false
---

# CI Parity Audit — Static Buildkite Pipeline vs. Old BK+Dagger Setup

Deep audit of the CI on `main` today (static `.buildkite/pipeline.yml` +
`.buildkite/scripts/` + `ci-image`, introduced with PR #1517 and hardened
through ~#1610) against the pre-#1516 setup (dynamic TypeScript pipeline
generator `scripts/ci/` + `.dagger/` module with 121 functions + lefthook).

Goal: verify every step/check that _actually ran_ in the old setup is present
(or consciously dropped) in the new one. Evidence-based: old side read at
`9b36f8b51` (parent of the removal commit), new side read from the live tree.

## Reference points

- Old setup last present at: `9b36f8b51`
- Removal: `6dba01a90` (#1516) — "remove all CI"; squashed stack `4f08817be`
  (#1517) also introduced the replacement static pipeline
- Parity-gap follow-ups already shipped: #1549 (required check, greptile gate,
  npm dev lane), #1563 (helm-types drift gate), #1571/#1576 (release gates),
  #1567 (scout lockstep deploys), #1610 (concurrency)

## Findings

### Verified parity (first-hand, main checkout + `git show 9b36f8b51:`)

- **Images**: all 13 old push targets (9 app: birmel, tasknotes-server,
  scout-for-lol, discord-plays-pokemon, discord-plays-mario-kart,
  starlight-karma-bot, streambot, temporal-worker, trmnl-dashboard; 4 infra:
  caddy-s3proxy, obsidian-headless, mcp-gateway, redlib) are targets in
  `docker-bake.hcl` (+ new `shelfbridge`). Smoke coverage preserved:
  `bake-images.sh` maps every app target to its package `smoke` script; infra
  smoked by `packages/homelab/scripts/smoke-images.ts`. pokeemerald wasm build
  moved into the dpp Dockerfile (pinned ottohg SHA) → exercised by images lane.
- **npm**: same 3 packages (astro-opengraph-images, webring, helm-types),
  prod (`publish:npm`) + dev (`publish-npm.ts --dev-suffix`) lanes both present.
- **Sites**: all 9 catalog entries deploy (7 sites + scout beta/prod, scout now
  via versioned `scout-site-release.ts` + promotion PR + prod reconcile).
- **Old "Quality Bundle" (18 children)**: shellcheck, quality-ratchet,
  check-todos, compliance-check, gitleaks, suppression-check, env-var-names,
  line-endings, scout-test-template, migration-guard, merge-conflict,
  react-version-sync, lockfile-check, prettier, markdownlint, ruff, pyright,
  eslint-automation — ALL present in root `verify` task list; task wiring
  spot-verified (`check:talos`, `lint:helm`, `check:1password`,
  `check:caddyfile`, `check:test-template`, `check:rehearsal`, `test:contract`
  all resolve to real scripts). eslint-automation → `scripts/` is now workspace
  pkg `@shepherdjerred/root-scripts` with a lint task.
- **Separate old steps**: knip (soft→now HARD in verify: upgrade), trivy
  (soft→soft on findings exit 7, hard on scanner crash: upgrade), semgrep
  (soft→soft on findings; now diff-aware vs merge-base), large-file-check
  (soft→hard in verify), caddyfile-validate → `check:caddyfile` + caddyfile
  smoke in images, tunnel-dns-coverage ✓, talos-schematic-sync → `check:talos`,
  helm-types-drift-check ✓ (restored #1563), greptile gate ✓ (wait-for-greptile),
  ios-native-deps ✓ (but see Gap 1).
- **Tofu**: old TOFU_STACKS = new list (7 stacks; argocd stack manual-only in
  both eras); github stack still no-auto-retry; cloudflare still gated on
  TunnelBinding deletion wait.
- **Release lane**: release-please (`scripts/release.ts`) ✓, release-please-PR
  auto-skip guard restored ✓, version commit-back with real digest plumbing ✓,
  cooklang publish + commit-back ✓, PR dry-run rehearsal lane (tofu plan,
  images bake+smoke, sites, helm, release) ✓ — old `--dryrun` plumbing restored.
- **Structurally moot**: dagger-hygiene (no Dagger), bun-lock-drift-check
  (single root bun.lock now — nested locks only in sandbox/archive),
  per-package `bun install` steps (one workspace install).
- **Required check**: old `buildkite/monorepo/pr/*` → single rolled-up
  `buildkite/monorepo/pr` in rulesets.tf; `ci/merge-conflict` (Temporal)
  unchanged.
- **Lefthook**: commit-msg + safety checks preserved; per-package eslint tiers
  superseded by `verify --affected` (same surface as CI).
- **sjer.red/resume verify exclusion**: not a gap — sjer.red `build` embeds
  `astro check && tsc`, covered by playwright-e2e steps; resume is xelatex-only.
- **SwiftLint**: old macOS step was gated off by default (never emitted);
  `lint:swift` now actually runs (swiftlint-static baked into ci-base). Upgrade.
- **No Buildkite schedules existed in either era** (tofu pipeline.tf).

### Gaps found (confirmed against both trees)

1. **`check:release-bundle` (tasks-for-obsidian) lost CI enforcement.** Old:
   step `ios-native-deps-tasks-for-obsidian` ran `check:ios-native-deps` AND
   `check:release-bundle` (release Metro bundle rehearsal — pure JS, ran fine
   on linux). New: package.json script removed in #1517; only
   `check:ios-native-deps` is in verify. AGENTS.md now says "run it locally
   before merging" — honor system for exactly the failure class that keeps
   recurring (Metro/Archive breakage, e.g. #1623 era).
2. **Scout desktop Rust checks degraded.** Old: `scout-desktop-rust` step ran
   cargo fmt + clippy + test. New: `@scout-for-lol/desktop-rust` turbo shim has
   `lint` (cargo fmt --check) reachable from verify, but `clippy` is a defined
   task NOT in the verify task list (turbo dry-run confirms it never runs) and
   cargo test isn't wired at all.
3. **Temporal HA-schema live validation lost.** Old: CI passed HASS_URL/HASS_TOKEN
   and ran live ha-codegen before temporal typecheck (literal-union narrowing →
   renamed HA entities failed the PR). New: `generate:live` is never invoked in
   CI; typecheck uses the permissive committed stub (empty entities/services).
   Not covered by the 2026-07-19 generated-code-freshness plan (4 items, HA
   schema absent).

4. **DPP pokeemerald wasm gating tests no longer run anywhere.** Old: the
   Dagger image build ran `emulator-symbols.integration.test.ts` +
   `audio-fingerprint.test.ts` against the freshly built from-source wasm —
   a Renovate OTTOHG pin bump that broke symbol resolution failed the build.
   New: the Dockerfile builds the wasm but only size-checks it (`> 10MB`), no
   `bun test` in any stage; verify's `bun test` self-skips the suite
   (`describe.skip` when `assets/pokeemerald.wasm` is absent — it is, in a
   clean checkout); the smoke config sets `game.enabled = false`. The test
   header still claims the gate "runs against the real artifact" in the wasm
   build — stale (describes the old Dagger flow). A symbol-breaking pin bump
   now ships and fails at runtime in goal mode. (Adjacent to, but NOT covered
   by, freshness-plan item 1, which is about the species/map data tables.)

### Cross-checks from enumeration subagents (reconciled, verified live)

- Scout asset-size budget: preserved — `scripts/check-large-files.ts` part 1
  runs `packages/scout-for-lol/scripts/check-asset-sizes.ts` (and the check
  went soft→hard). ✓
- Streambot real-ffmpeg/libass subtitle integration suite: preserved —
  `packages/streambot/scripts/smoke.ts` runs `bun run test:integration`
  inside the images lane (still the only place it can run). ✓
- Temporal schedule rehearsal (old temporal-worker "smoke"): preserved twice —
  `check:rehearsal` in verify (cache:false) + `packages/temporal` smoke. ✓
- tasknotes contract test (old dual-emission from both packages): now a single
  `test:contract` task in tasks-for-obsidian; main runs full verify so
  server-side changes are covered there regardless of affected-scoping. ✓
- Old gating nuance: knip/trivy/semgrep/tunnel-dns/talos were NOT wired into
  the old required check (`ci-complete`) — tunnel-dns and talos were
  effectively advisory despite being hard steps. Both now block via verify:
  another upgrade, not a regression.
- Greptile gate: blocking today (no soft_fail), matching the old
  blockingGates wiring; it was soft during the replatform window and #1549
  restored it. Prose in several docs/skills still calls it soft-fail — stale.

### Doc staleness noticed (not fixed in this session)

- `~/.claude/skills/buildkite-helper/SKILL.md` header claims the pipeline was
  removed 2026-07 and "nothing runs on commit/push/PR; verification is
  manual" — false since the parity rebuild landed. Its soft-fail list also
  says knip is soft (now hard).
- `emulator-symbols.integration.test.ts` header claims the wasm build runs the
  gate (see Gap 4).
- Several docs (temporal CLAUDE.md, homelab notes) call the greptile gate
  soft-fail; the live pipeline blocks on it.

### Classification against the replatform's own tracking doc

`packages/docs/plans/2026-07-13_ci-parity-implementation.md` (status:
awaiting-human) is the parity ledger. Reconciliation:

- Gap 1 (`check:release-bundle`) was **consciously dropped but with a wrong
  rationale**: the plan groups it with Maestro e2e + Xcode Cloud as "outside
  Buildkite by physics (no macOS agents)". The check is pure JS (its own
  header + tasks-for-obsidian/AGENTS.md say it runs anywhere) and the OLD CI
  ran it on Linux. The physics argument applies to Maestro/Xcode Cloud only.
- Gap 2 (clippy/cargo test) is an **unrecorded miss** — it violates the plan's
  own invariant ("every task runnable locally runs in CI, or is explicitly
  operator-only below"); clippy/cargo-test appear nowhere in the operator-only
  list. Old `.dagger/src/rust.ts` ran fmt + clippy `-D warnings` + `cargo test`.
- Gap 3 (`generate:live`) is a **documented conscious drop** ("operator-only:
  live Home Assistant / chart-repo credentials; typecheck/test self-manage
  stubs"). Defensible hermetic-CI call, but no freshness automation replaced
  it, unlike helm-types which got the #1563 drift gate.
- Everything else the plan lists as "explicitly dropped" is genuinely
  Dagger-plumbing-only (hygiene check, git-URL refs, engine cache GC, dynamic
  generator, resource tiers, build-age priority) — verified no check content
  was lost with them.

### Old→new structural equivalences (verified, not gaps)

- `quality-gate` + `ci-complete` aggregation steps → single rolled-up
  `buildkite/monorepo/pr` required status (every non-soft step now gates:
  strictly stronger). `ci/merge-conflict` (Temporal) unchanged.
- `homelabCdk8sBundleStep` (cdk8s synth + 1Password lint) → verify
  (build + check:1password) + cdk8s dist uploaded as Buildkite artifact,
  consumed by helm-push.
- ci-base `VERSION` pin + version guard + commit-back → mutable `:latest` +
  `imagePullPolicy: Always` + runtime mise bootstrap in toolchain.sh +
  main-only ci-image-refresh step.
- Old PR dry-run site builds (the OG-image `jsxDEV` guard) → sites-pr dry-run
  lane; also now rehearses scout archive/deploy-beta/reconcile/promote.
- Loop-prevention (isAutoGenerated / Auto-Generated trailer skips) → digest
  no-change skip in version commit-back + tag-idempotent cooklang publish +
  release-please-branch webhook auto-skip guard.

### Upgrades over the old setup (context, not asks)

knip + large-files soft→hard; trivy/semgrep soft only on findings (scanner
crash is hard, semgrep now diff-aware vs merge-base); SwiftLint actually runs
(old macOS step was permanently gated off); jscpd new; llm-observability
docker-compose e2e lane; per-step `if_changed` fail-open selectors; turbo
remote cache; verify surface identical across CI / pre-commit hook / local.

### Docs-context additions (from subagent sweep, reconciled)

- A prior gap audit (`logs/2026-07-18_ci-parity-gap-audit.md`) found 3 gaps
  (required check off, greptile soft-failed, stale ci-image clause) — all
  fixed in #1549; its "Verified NOT gaps" section independently matches this
  audit's parity findings.
- Systemic accepted losses of any Dagger exit (from the superseded
  `2026-07-11_ci-replatform-dagger-exit.md`): 7-day cross-build function
  memoization → several narrower caches, and hermeticity by convention
  (pinned images + lockfiles) rather than enforcement. Trade-off, not a check.
- Still-open CI-adjacent items (todos): **Dagger engine/namespace/2Ti ZFS PVC
  teardown** is the only strip follow-up genuinely pending
  (`todos/argocd-apps-prune-policy.md`, in-progress — 9 orphaned resources);
  `turbo-cache-rollout` awaiting-human (verify remote cache hits end-to-end);
  `mac-mini-buildkite-agent` planned (would promote Maestro e2e + TaskNotes
  differential test into CI — also the honest path to CI-gating the iOS lane);
  semgrep's ~108-finding triage / scanner soft-fail policy decision still open
  (from `logs/2026-07-19_ci-5809-end-to-end-audit.md`).
- Known turbo limitation: nested-package `--affected` under-selection
  (turbo 2.10.4) — native shims run unconditionally as the workaround
  (`archive/completed/2026-07-12_turbo-buildout-derisk.md`).

## Session Log — 2026-07-25

### Done

- Full parity audit of static Buildkite pipeline vs pre-#1516 BK+Dagger CI.
  Old side read at `9b36f8b51` (catalog, pipeline-builder end-to-end, steps/\*,
  .dagger quality.ts + rust.ts + misc.ts, lefthook); new side read first-hand
  (all 1362 lines of pipeline.yml, bake-images.sh, verify wiring, turbo
  dry-run for the Rust shim, lefthook, rulesets.tf, tofu stacks).
- Three enumeration subagents (old-CI, new-CI, docs) completed and were
  reconciled; their deltas were re-verified against the live tree and
  produced Gap 4 (dpp wasm gates) plus the cross-check confirmations above.
- Final tally: 4 gaps (1 wrong-rationale drop, 2 unrecorded misses,
  1 documented-but-unmitigated drop); everything else parity or better.

### Remaining

- User decision on the four gaps: (a) wire `check:release-bundle` back into
  verify (pure JS, no macOS needed), (b) add `clippy` to the verify task list
  and a `cargo test` script to the src-tauri shim, (c) restore the dpp wasm
  gating tests (`RUN bun test` of the two suites in the Dockerfile
  wasm/runtime stage, or copy the wasm out and run them in the images lane),
  (d) decide on HA-schema freshness automation (fits the existing Temporal
  clone→regen→PR pattern from the 2026-07-19 freshness plan).
- Optional doc hygiene: fix the three stale claims listed under "Doc
  staleness noticed".

### Caveats

- Buildkite org/agent-stack teardown items from #1516 are tracked in the strip
  plan; the only genuinely pending live-system follow-up is the Dagger
  engine/namespace/2Ti PVC prune (`todos/argocd-apps-prune-policy.md`).
- Semgrep finding-triage policy (~108 findings, soft-fail) is a pre-existing
  open decision from the 5809 audit, not introduced by the replatform.

## Workflow Friction

- `~/.claude/skills/buildkite-helper/SKILL.md` opens with a "pipeline was
  removed 2026-07, verification is manual" warning that is now false — it
  actively misleads any CI-related session that loads the skill (this one
  had to disprove it from git history first). The chezmoi source under
  `packages/dotfiles/dot_agents/skills/` (if present there) needs the same
  fix. Rewrite the header to describe the static-pipeline reality.
