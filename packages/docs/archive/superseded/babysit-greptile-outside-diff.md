---
id: babysit-greptile-outside-diff
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-06-27_pr-babysit-bot.md
---

# Babysitter DoD: cover Greptile "comments outside of diff"

This card targeted a Greptile-specific review-body format that had no stable
resolution signal.

## Supersession Evidence

- The repository now selects review providers through the provider-neutral
  `@shepherdjerred/code-review` gate, with Codex as the default provider.
- Blocking review state is defined by resolvable, non-outdated review threads;
  provider-specific completion signals are handled in the shared package.
- Adding a second Greptile-only interpretation path to the retired babysitter
  contract would diverge from the current required gate.

## Comment Log

### 2026-07-27 — in-progress board audit

- Archived as obsolete after the review-provider cutover. Any future provider
  coverage gap belongs in the shared provider adapter and required gate.
