# Renovate Blocked Majors

## Status

Active. Replaces the archived 2026-04-21 dashboard cleanup session log.

## Remaining Work

- Framework and language majors that need dedicated sessions: ESLint 10, TypeScript 6, Astro 6, Zod 4, React Native 0.84, Prisma 7, Gradle 9, Java 25, and JVM/Birmel media dependency majors.
- Production image pin promotions for Scout and starlight-karma-bot should be handled as explicit deploy work, not routine dependency cleanup.
- Dagger CI infrastructure failures are tracked separately in `2026-04-21_dagger-ci-infra-fixes.md`.

## Acceptance

- Each major migration gets a focused branch with targeted tests for affected packages.
- The Renovate dashboard is updated or closed only after the corresponding package tests and CI path pass.
- Session logs stay archived; this file remains the active high-level tracker.
