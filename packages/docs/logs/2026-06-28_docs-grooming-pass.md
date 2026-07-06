# Docs Grooming Pass — 2026-06-28

## Status

Complete

A full reorganize/update/groom pass over `packages/docs/`. The core finding: `## Status`
lines across `plans/` (and `status:` across `todos/`) were pervasively **stale** — work
shipped to `main` weeks ago (HEAD at PR #1345) while the docs still read "In Progress" /
"Not Started" / "pending merge". Actual completion was verified against the live tree +
git history (not the Status field) via parallel read-only agents, with per-item evidence
(commit SHA / PR # / file path).

## What changed

### Plans

- **Archived 84 shipped plans** `plans/ → archive/completed/` (`git mv`, history preserved).
  `plans/` went 116 → 32; `archive/completed/` 93 → 177.
- **Corrected stale `## Status` lines** on the archived docs to `Complete — shipped in PR #NNNN`
  (57 files via 4 parallel content-only agents; 2 had no Status section and got one inserted:
  `discord-plays-mario-kart`, `mk64-latency-instrumentation`).
- **Corrected 4 KEEP plans** whose Status was wrong:
  - `ci-quality-hardening` — claimed knip/trivy hardened; verified all three (knip/trivy/semgrep)
    are still `softFail: true` in `scripts/ci/src/steps/quality.ts:73,84,139` — hardening unmet.
  - `opentofu-audit-expansion`, `polyrepo-link-audit`, `renovate-blocked-majors` — landed work folded in.
- **Fixed `pr-babysit-bot`** self-contradictory Session Log (header said Phases 0–3 shipped #1334; log "Remaining" said Phases 1–5 not started).

### Todos

- **Deleted 3 verified-resolved** (no live source markers): `helm-types-publish-success`,
  `scout-app-launch` (#1265), `scout-marketing-image-regen` (c010065ba). 34 → 31 docs.
- **`discord-packages-npm-publish`** `blocked → active` (blocker `discord-stream-lifecycle` is on main #1146).
- **`scout-prod-prisma-7-affinity`** annotated: 2/3 done (libsql migration + regression test landed);
  only prod-data repair remains.
- **Repointed 7 dangling `origin:`** paths (`plans/<moved>` → `archive/completed/<moved>`).

### Index / links

- Added 1 missing decision (`dagger-gc-and-pvc-drift`) + 4 missing guides to `index.md`.
- Recomputed archive counts: completed `87 → 177`, superseded `9 → 10`.
- Fixed broken relative link in `archive/superseded/2026-06-13_dpp-audio.md` (`./` → `../completed/`).

## Verification

- `bun scripts/check-todos.ts` → 1 source marker, 31 docs, all OK.
- Every `index.md` link target resolves.
- `plans/` = 32, `archive/completed/` = 177; counts match index.
- `git status` is docs-only (zero non-docs changes).

## Session Log — 2026-06-28

### Done

- Verified actual completion of all 116 plans + 34 todos against the live tree (6 parallel read-only agents).
- Archived 84 plans, corrected ~61 Status lines, deleted 3 resolved todos, fixed 1 todo status, repointed 7 origins, updated index + 1 broken link. All in worktree `feature/docs-grooming`.

### Remaining

- **~7 `waiting-on-verification` todos are repo-done but gated on a live cluster/prod check** I cannot run
  from the repo: `agent-task-workflow-broken`, `buildkite-pvc-expansion-confirmed`,
  `disable-buildkite-readme-schedule`, `grafana-trace-log-prod-verification`, `mk64-emulator-worker-thread`,
  `pagerduty-velero-alert-formatting`, `scout-migration-competition-update-schedule`,
  `scout-orphan-guild-prod-cleanup`, `scout-report-backends-verify`. Each doc already records the exact check.
  Optional: schedule report-only `temporal-agent-task`s to confirm them.
- `firmware-update-runbook` is a runbook living in `plans/`; could relocate to `guides/` (left as-is).

### Caveats

- Three pre-existing `archive/completed/` docs (`2026-04-04_pv-expansion`, `2026-05-10_ci-disk-write-reduction`,
  `2026-06-13_dpp-audio-v2`) carry non-"Complete" status lines; outside this pass's 84, left untouched.
- Archive verdicts trusted the per-item evidence (PR #/SHA/path) from the verification agents; several
  June PRs were squash-merged so the cited feature-branch SHAs aren't ancestors of HEAD — verdicts relied
  on the shipped files/symbols existing on `main`.
