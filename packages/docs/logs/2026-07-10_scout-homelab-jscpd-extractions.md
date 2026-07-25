---
id: log-2026-07-10-scout-homelab-jscpd-extractions
type: log
status: complete
board: false
---

# Scout + Homelab jscpd Duplication Extractions

## Status Notes (Historical)

Complete

Behavior-preserving extraction of the top code-duplication clusters flagged by
`custom-rules/no-code-duplication` (jscpd) in `scout-for-lol`. Homelab was
investigated and found to have zero real duplication.

## Homelab — no action (false lead)

The `no-code-duplication` rule is gated behind `analysisRules: true` in the
shared eslint-config, which `packages/homelab/src/cdk8s/eslint.config.ts` does
NOT pass — so the rule is disabled there and homelab lint reports zero
duplication. Running `jscpd` directly on `src/cdk8s` confirmed every `.ts`
clone lives in `generated/helm/*.types.ts` (the committed Helm value types,
correctly ignored by eslint's `ignores: ["generated/"]`). There is **no real
duplication in hand-written cdk8s source**. The earlier report claiming
monitoring↔logging Helm-release boilerplate was not reflected in actual output.
cdk8s `bun run test`: 252 pass / 4 skip / 0 fail.

## Scout — extractions

Baseline (full-package `bunx eslint .`): **641** duplication warnings.
Final: **600** (net **−41**), **0 eslint errors**, all typecheck + tests green.

### Backend

- `src/lib/audit/audited-mutation.ts` (new) — `runAuditedMutation(ctx, guildId,
run, audit)` wraps the repeated `prisma.$transaction(tx => { result =
domainCall(tx); if (predicate) recordAudit({...common, ...specific}, tx);
return result })` shape and threads `actorDiscordId`/`ipAddress`/`userAgent`
  from ctx. Adopted in all 5 mutation procedures of
  `src/trpc/router/subscription.router.ts` (20 → 10 warnings). Verified by the
  existing offline tRPC harness tests (`subscription-filters.router.test.ts`).
- `src/report-store/store.ts` (13 → 5) — extracted `storedMatchCommon`,
  `matchFactCommon`, `storedPrematchCommon` field objects spread into the
  `create`/`update` arms of each Prisma upsert (mirrors the pre-existing
  `prematchParticipant{Create,Update}Data` pattern).
- `src/database/competition/participants.ts` (9 → 4) — extracted
  `participantKey(competitionId, playerId)` (composite-key where-clause) and
  `findParticipant(...)` (the shared `findUnique`-or-null lookup), applied to 5
  findUnique sites + 2 update where-clauses. Params typed `number` since
  branded `CompetitionId`/`PlayerId` widen to `number`.

### App (all within-package)

- `src/components/dialog-form.tsx` (new) — `DialogFormError` +
  `DialogFormFooter` (Cancel + submit-with-pending, optional `submitDisabled`
  and `submitVariant`). Adopted across **9** mutation dialogs: transfer-account,
  subscription-filter, edit-account, rename-player, merge-players,
  subscription-channel, link-discord, add-subscription, add-account. Removed
  the now-unused `Button`/`DialogFooter` imports from each.
- `src/components/onboarding/onboarding-step-frame.tsx` (new) — wraps
  `OnboardingShell` + the identical no-channels fallback. Adopted in
  `onboarding-report-step.tsx` (9 → 6) and `onboarding-competition-step.tsx`.

### Frontend (within-package)

- `src/components/review-tool/review-tool-modal.tsx` (new) — shared modal shell
  (backdrop + centered dialog + sticky header with close-X + footer slot).
  Adopted in `config-import-modal.tsx` (10 → 4) and `config-modal.tsx` (the
  latter's reset-confirm sub-dialog kept inline as a fragment sibling).
- `config-import-modal.tsx` also got a local `parseAndSetBundle(input)` helper
  collapsing the duplicated parse-JSON try/catch used by the paste + upload
  paths.

## Judgment calls — left as-is

- **`store.ts` ↔ `report-lake/flatten.ts`** (the 4 `participant*` derivation
  helpers): byte-identical but **intentionally** so — an in-code comment
  (flatten.ts:20-23) states they match store.ts's fact-table derivations,
  pinned by unit tests, "until the fact tables are dropped in the follow-up
  PR." Deliberate temporary duplication with a planned removal path; extracting
  now would fight the documented migration intent. Left it.
- **`reports/query-engine-legacy.ts` ↔ `query-engine.ts`**: skipped per
  instructions — legacy/new migration pair.
- **subscription-filter-dialog.tsx (11 → 12)**: ticked up by 1. jscpd artifact —
  removing the footer/error clones caused jscpd to re-anchor on the surviving
  per-dialog `<form>`/field-block structure against sibling dialogs. The real
  shared plumbing did move into `dialog-form.tsx`; the net package direction is
  −41.
- Remaining subscription.router duplication (10) is the per-procedure input
  literal + `runAuditedMutation` call shape — genuinely different fields per
  procedure; forcing further abstraction would obscure per-procedure semantics.

## Verification

- Backend typecheck ✓; `bun test` 1092 pass / 6 skip (expected env-gated) / 0 fail.
- App typecheck ✓; `bun test` 12 pass / 0 fail.
- Frontend `astro check` + tsc ✓ (no active test suite — playwright disabled).
- Homelab `bun run test` 252 pass / 4 skip / 0 fail (untouched).
- Full scout eslint: 0 errors; duplication 641 → 600.
- No off-limits files touched (`src/discord/commands/**`, deleted ui/\* files, homelab).

## Session Log — 2026-07-10

### Done

- New shared helpers: `backend/src/lib/audit/audited-mutation.ts`,
  `app/src/components/dialog-form.tsx`,
  `app/src/components/onboarding/onboarding-step-frame.tsx`,
  `frontend/src/components/review-tool/review-tool-modal.tsx`.
- Refactored: subscription.router.ts, store.ts, participants.ts (backend);
  9 dialogs + 2 onboarding steps (app); config-import-modal.tsx,
  config-modal.tsx (frontend).
- Scout duplication 641 → 600 (−41), 0 eslint errors, all typecheck/tests green.
- Confirmed homelab has no real duplication (rule disabled there; all clones in
  generated Helm types); no homelab changes made.

### Remaining

- None for this assignment. Deeper reduction of the surviving per-dialog and
  per-procedure structural similarity would require heavier abstraction that
  trades readability for jscpd count — not pursued.

### Caveats

- `store.ts` ↔ `flatten.ts` duplication intentionally left (documented
  temporary duplication pending fact-table removal in a follow-up PR).
- Worktree branch `quality-burndown` contains unrelated in-progress changes
  from other agents (temporal, tasks-for-obsidian, cooklang, karma-bot,
  eslint-config); only the 15 scout files above are mine.
