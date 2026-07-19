---
id: log-2026-07-03-tasknotes-rework-status
type: log
status: complete
board: false
---

# TaskNotes First-in-Class Rework — Status, Follow-ups, What's Left

## Progress at a glance

| Phase | Scope                                                                                                   | State                                    | PR                                                            |
| ----- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| P0    | Test foundations: contract suite, sync-sim harness, Maestro e2e + chaos proxy, iOS 27 build repairs     | ✅ Code complete                         | [#1388](https://github.com/shepherdjerred/monorepo/pull/1388) |
| P1    | Server micro-patch: `X-Mutation-Id` idempotency, complete-instance `{date, completed}`                  | ✅ **Merged + deployed path**            | [#1379](https://github.com/shepherdjerred/monorepo/pull/1379) |
| P2    | App offline-first sync rework (kills the double-execution data loss), local-date fix                    | ✅ Code complete                         | [#1390](https://github.com/shepherdjerred/monorepo/pull/1390) |
| P3    | Server rebuilt on `@tasknotes/model` + tasknotes-types v2 + `/legacy` adapter + migration/audit scripts | ✅ Code complete                         | [#1391](https://github.com/shepherdjerred/monorepo/pull/1391) |
| P4    | Operational rollout: backups → vault migration → deploy → post-audit                                    | ⏳ Blocked on PR merges + operator       | — (no PR by design)                                           |
| P5    | App on the v2 contract + recurrence UX + wikilink projects + archived filtering                         | ✅ Code complete                         | [#1394](https://github.com/shepherdjerred/monorepo/pull/1394) |
| P6    | Cleanup: delete `/legacy` adapter + legacy types exports, retire old TestFlight build                   | ⏳ Blocked on P4+P5 shipping (by design) | —                                                             |
| Lab   | Mac Mini test lab, ob-sync transport test, differential test, prod canary                               | ⏳ Blocked on hardware/creds             | —                                                             |

**Merge order matters (stacked):** #1388 → #1390 → #1391 → #1394. Each PR's base is the previous branch, so merging in order keeps every diff reviewable in isolation.

## What shipped (one paragraph per phase)

- **P0** — A contract suite running the app's real `TaskNotesClient` against a spawned real server; a deterministic sync-simulation harness (manual clock, offline/failure injection, snapshot-able storage for crash tests); a 7-flow Maestro e2e suite with a chaos proxy for offline simulation and vault-byte assertions; and the iOS 27 build chain repaired (UIScene/SceneDelegate, React pin, Metro/babel fixes).
- **P2** — The app's store is now `view = rebase(baseSnapshot, pendingCommands)` over a durable FIFO command queue: absolute-state commands (never toggles), `X-Mutation-Id` idempotency keys, temp-ID aliases, dead-letter review UI, single-flight sync engine with backoff and error classification. The enqueue + direct-call + replay triple execution — the root data-loss bug — is deleted. Getting the e2e gate green (first full pass ever) also fixed two real UI bugs (Quick Add button hidden behind the keyboard when offline; permanently stuck "Syncing…" banner) and four harness reliability holes (stale server on fixed ports being the historic red's root cause).
- **P3** — The server's hand-rolled vault layer is replaced by `@tasknotes/model` (the plugin's own engine): tolerant reads with loud skip reporting (`/api/engine-status`), surgical read-modify-write mutations that survive concurrent Obsidian edits byte-for-byte, config from the plugin's own `data.json`, workflow-cycling toggle-status, model-driven recurrence, time tracking in frontmatter. Two HTTP surfaces: `/api/*` (upstream v2 contract) and `/legacy/api/*` (old camelCase contract for the interim app). Plus `scripts/migrate-vault.ts` (idempotent, dry-run default) and `scripts/vault-audit.ts` (P4 gate), a golden corpus of parse kill-cases, conformance tests against the model's spec harness, and HTTP-level concurrency tests.
- **P5** — The app speaks the v2 contract through a single wire-boundary module (`src/domain/wire.ts`); the internal domain model is unchanged, so **no storage migration** was needed. Recurring tasks finally behave: per-day checkbox state via `isCompletedOn` and rrule expansion via `occursOn` put scheduled-anchored tasks on Today/Upcoming instead of perpetual overdue. Wikilink and bare-name projects unify (`projectMatches`); archived tasks filter client-side.

## Verification state

| Layer                             | Result                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| tasknotes-server unit/HTTP suites | 149 tests green (engine kill-cases, corpus + spec pin, v2 + legacy routes, idempotency crash-replay, concurrency, migration) |
| tasks-for-obsidian unit suites    | 267 tests green (offline scenarios, recurrence semantics, wikilink matching)                                                 |
| tasknotes-types                   | v3/v4 schema drift-pin tests green                                                                                           |
| Contract (app ↔ real server)      | 18/18 on `/api` (v2, P5 branch) and 18/18 on `/legacy` (P3 branch)                                                           |
| Maestro e2e (full stack, iOS sim) | **7/7 flows + vault-byte assertions** — P5 app against P3 server; proves Metro bundles `@tasknotes/model`                    |
| Conformance                       | Server behavior equals `executeConformanceOperation` verdicts; `TASKNOTES_SPEC_VERSION` pinned 0.2.0                         |

## Follow-ups (concrete)

### Operator (Jerred) — gates everything downstream

1. **Review + merge the stack in order**: #1388 → #1390 → #1391 → #1394.
2. **Provision an Obsidian Sync test-vault slot** for the Ring-3 transport test (Standard plan = 1 slot, Plus = 10). This ideally runs **before** the P4 migration so real conflict behavior informs confidence in the concurrency model (currently assumed LWW, repo-level survival tested locally only).
3. **P4 rollout window** (quiet hour, single sitting — full checklist in the plan's P4 section):
   - `velero backup create tasknotes-pre-rework --include-namespaces tasknotes --wait` + `kubectl exec … tar czf` vault tarball (Obsidian Sync history is the third path).
   - Dress rehearsal on a **copy** of the real vault: `bun run scripts/vault-audit.ts <copy>` must be 100% clean; `migrate-vault.ts <copy>` dry-run diff reviewed.
   - Deploy the P3+ image → dry-run on the live vault → `--apply` → post-audit clean → desktop Obsidian plugin reads/edits everything (the ultimate oracle).
   - Point the **interim** production app at `<server>/legacy` (Settings → API URL) until the P5 TestFlight build ships; then switch back to the root URL.
4. **TestFlight build** of the P5 app after merge (Xcode Cloud path documented in the app CLAUDE.md).
5. **Mac Mini lab setup** when convenient (tailnet, Xcode, Maestro, real Obsidian + plugin on the test vault) — unlocks the differential test and full-loop e2e.

### Agent-executable (next sessions)

6. **P6 cleanup** (after P4+P5 ship): delete `src/legacy/` + legacy `tasknotes-types` exports + the closed-enum caveat notes; retire the old TestFlight build; `git mv` the plan to `archive/completed/`.
7. **Ring 3 transport test** (`sync-transport-test.ts`, needs item 2): two `ob sync` replicas, assert propagation + document real conflict semantics on task frontmatter.
8. **Differential test vs the real plugin** (`differential-test.ts`, needs item 5): same op sequence against the plugin's HTTP API and ours; byte-diff the vaults. Gate for future model/plugin upgrades.
9. **Prod canary** (post-P4): Temporal report-only task creating/completing/deleting a marker-tagged task via the prod API, emailing red/green.

## What's left, honestly

- **Nothing code-shaped remains** in P0–P5. P4 is operations; P6 is intentionally sequenced after deployment (deleting the `/legacy` adapter now would strand the production app during the rollout window); the lab track needs hardware/credentials.
- **Known accepted limitations** (documented in code/PRs):
  - The app keeps closed status/priority enums; a plugin-configured custom workflow status fails response validation loudly rather than being remapped. Fine for this vault (post-migration statuses are the defaults); open-workflow support would be a new phase.
  - Obsidian-side renames orphan queued mutations targeting the old path → they dead-letter with an honest message (by design; rename tombstones are a possible future).
  - Maestro e2e remains a **local pre-merge gate** (no macOS CI agents) — `packages/docs/todos/mac-mini-buildkite-agent.md`.
  - Obsidian Sync conflict behavior on frontmatter is still an _assumption_ until the Ring-3 test runs (item 2/7).

## Risk notes for the rollout

- P4 briefly leaves legacy tasks invisible to the new server until `--apply` runs — that is why the window is quiet-hours and backup-gated.
- `@tasknotes/model` is young (0.2.1, pinned exact). Renovate will propose bumps; the conformance suite + spec-version pin turn a semantic change into a named test failure instead of drift.
- If anything goes sideways post-deploy: Velero restore, vault tarball, and Obsidian Sync version history, in that order of preference.
