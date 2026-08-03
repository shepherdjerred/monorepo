---
id: plan-2026-04-25-renovate-blocked-majors
type: plan
status: complete
board: false
---

# Renovate Blocked Majors

## Remaining Work

- Framework and language majors still needing dedicated sessions: Gradle 9, Java 25, and JVM/Birmel media dependency majors. (Landed since this plan: TypeScript 6 `242667be2`/`b02ab1dcc`, Zod 4, ESLint 10, Astro 6, Prisma 7, React Native 0.85 — verified on `main` 2026-06-28.)
- Production image pin promotions for Scout and starlight-karma-bot should be handled as explicit deploy work, not routine dependency cleanup.
- Dagger CI infrastructure failures are tracked separately in `2026-04-21_dagger-ci-infra-fixes.md`.

## Acceptance

- Each major migration gets a focused branch with targeted tests for affected packages.
- The Renovate dashboard is updated or closed only after the corresponding package tests and CI path pass.
- Session logs stay archived; this file remains the active high-level tracker.

## Remaining

- [x] Re-audit the previously blocked Gradle 9 and Java 25 upgrades against the live dependency dashboard.
- [x] Close this stale tracker: the repository no longer contains a Gradle project, Java 25 is already pinned, and the surviving AI ecosystem gate is tracked separately.

## Session Log — 2026-07-27

### Done

- TypeScript 6, Zod 4, ESLint 10, Astro 6, Prisma 7, and React Native 0.85 are already merged; only independent major migrations remain.

### Remaining

- See the current `## Remaining` checklist above.

### Caveats

- The 2026-07-27 board audit replaced generic or stale completion language with current ownership and verification semantics.

## Session Log — 2026-08-02

### Done

- Rechecked the live repository and Renovate dependency dashboard #481: no Gradle or Java major remains, and `.mise.toml` already pins Java 25.
- Confirmed the still-gated AI dependency family has a current dedicated tracker, then completed this superseded umbrella plan.

### Remaining

- None.

### Caveats

- This archive action does not reject future JVM work; it removes a tracker whose named upgrades no longer exist.
