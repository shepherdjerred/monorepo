---
id: plan-2026-04-25-renovate-blocked-majors
type: plan
status: in-progress
board: true
verification: agent
disposition: active
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

- [ ] Complete and verify the work described in `Renovate Blocked Majors`.
