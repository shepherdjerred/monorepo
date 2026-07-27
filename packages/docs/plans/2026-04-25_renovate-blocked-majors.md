---
id: plan-2026-04-25-renovate-blocked-majors
type: plan
status: planned
board: true
verification: agent
disposition: deferred
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

- [ ] Re-audit the currently blocked Gradle 9 and Java 25 upgrades against the live dependency dashboard.
- [ ] Create one focused migration item per still-blocked JVM/Birmel media major; close this tracker when every current major has an owner or explicit rejection.

## Session Log — 2026-07-27

### Done

- TypeScript 6, Zod 4, ESLint 10, Astro 6, Prisma 7, and React Native 0.85 are already merged; only independent major migrations remain.

### Remaining

- See the current `## Remaining` checklist above.

### Caveats

- The 2026-07-27 board audit replaced generic or stale completion language with current ownership and verification semantics.
