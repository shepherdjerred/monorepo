---
id: reference-completed-2026-05-16-pr-review-bot-usefulness-gap-close
type: reference
status: complete
board: false
---

# PR Review Bot Usefulness Gap Close

## Summary

Recent PR inspection showed the summary pipeline is useful, but the review
pipeline missed or failed to publish the most useful findings that CodeRabbit
surfaced. This plan closes the immediate gap by adding deterministic checks for
the miss classes, making replay exercise the production path, and making empty
reviews honest about coverage.

## Implementation Plan

- Add deterministic pre-consensus findings for container image refs and package
  manifest/runtime dependency issues. These checks should emit normal
  `Finding` objects with verified evidence so they flow through existing
  dedupe and posting.
- Extend verifier targets for `container-image` and `package-manifest`, then
  teach the deps/correctness/convention prompts when to use them.
- Update review comment rendering so it no longer claims a clean review when
  coverage was partial, specialist passes failed, verification was skipped, or
  only baseline stages ran.
- Upgrade replay tooling from the old baseline-only path to the full review
  pipeline stages: bootstrap, deterministic signals, specialists, consensus,
  verification, dedupe, and rendered comment.
- Add regression coverage for the recent misses:
  - Missing GHCR image tags from image-version PRs.
  - React Native/native runtime peer dependencies satisfied only by
    `devDependencies` or `optionalDependencies`.

## Verification

- `cd packages/temporal && bun test src/activities/pr-review src/lib`
- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run lint`
- Replay recent PRs with read-only tooling once required tokens are available.
