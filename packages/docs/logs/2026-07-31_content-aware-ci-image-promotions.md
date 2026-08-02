---
id: log-2026-07-31-content-aware-ci-image-promotions
type: log
status: complete
board: false
---

# Content-aware CI image promotions

## Summary

Add a second, runtime-content identity check after CI image candidates build.
Candidate builds remain enabled for CI-related source changes, but the promotion
workflow must not open a digest-pin pull request when the candidate has the
same effective runtime image as the current immutable pin.

## Session Log — 2026-07-31

### Done

- Created the implementation worktree and prepared the Bun toolchain.
- Confirmed that application image promotions already use a normalized runtime
  fingerprint that captures rootfs and runtime configuration.
- Reused that oracle for `ci-base` and `ci-playwright` pin promotions.
- Suppressed pin PR creation when a candidate has an identical runtime image;
  preserve promotion when runtime content changes or the existing pin cannot
  be resolved, and fail when the candidate cannot be fingerprinted.
- Added focused coverage for all runtime-promotion outcomes.
- Verified with focused Bun tests, root-scripts lint/typecheck, Prettier, and
  `bun run check-todos`.

### Remaining

- Buildkite build #7519 must validate the real registry inspection path on
  draft PR #1887.

### Caveats

- Candidate-build selection intentionally remains broad; this session changes
  promotion eligibility, not whether CI-related changes may rebuild images.
- A missing current pin is reported and replaced with the verified candidate;
  a missing candidate fingerprint remains a hard failure.
- Draft PR: https://github.com/shepherdjerred/monorepo/pull/1887
- Hosted CI was pending at handoff: https://buildkite.com/sjerred/monorepo/builds/7519

## Session Log — 2026-08-01

Addressed the two Codex review findings that were failing the
`robot-face-review-gate` on PR #1887 (verify already green).

### Done

- **P1 — retire stale promotions before skipping** (`update-ci-image-pin.ts`):
  when the runtime outcome is `content-unchanged`, the build now closes any
  still-open pin PR on the pending branch and deletes that branch before
  returning. Previously the early return left an auto-merge-enabled PR that
  could later land a superseded digest even though the build decided no
  promotion was warranted. Added `retireStalePromotion`; gated on an existing
  pending branch.
- **P2 — CI-specific runtime identity** (`application-image-runtime.ts`): made
  the ignored-`Env` prefixes configurable. Application images keep stripping the
  disposable `VERSION=`/`GIT_SHA=` bake identities (new
  `APPLICATION_IGNORED_ENV_PREFIXES` default); CI images now strip nothing
  (`CI_IMAGE_IGNORED_ENV_PREFIXES = []`) so a CI Dockerfile `ENV VERSION=`/
  `GIT_SHA=` change is no longer misclassified as `content-unchanged`. The CI
  reader in `update-ci-image-pin.ts` passes the CI prefix set.
- Added regression tests: CI-vs-application env normalization in
  `bake-images.test.ts`, and a structural guard in `update-ci-image-pin.test.ts`
  that the content-unchanged path retires the stale PR.
- Verified: focused Bun tests (44 pass), `.buildkite` typecheck, root-scripts
  buildkite lint, Prettier — all clean.

### Remaining

- A fresh Codex review runs on the new head; the gate goes green once it
  re-reviews and finds the findings resolved (prior review latency was ~2h).

### Caveats

- The `promote` orchestrator remains integration-style (real `git`/`gh`); its
  new retire path is covered by a source-structure assertion, consistent with
  the existing lockfile-ordering test in the same file.

## Session Log — 2026-08-02

Codex's re-review of the 2026-08-01 fix raised one new **P1** ("Preserve
inspect failures for transient handling") — a hole in the runtime-fingerprint
path this PR relies on. Fixed it; the older P2 was already resolved.

### Done

- **P1 — preserve transient inspect failures** (`application-image-runtime.ts`,
  `scripts/lib/transient.ts`): `imageRuntimeFingerprint` no longer collapses
  every `imagetools inspect` failure to `undefined`. It now classifies a
  non-zero result with `bakeFailureIsTransient`; a transient registry/BuildKit
  failure throws a new `TransientError` that preserves the stderr diagnostics,
  and `runMain` maps that to `EXIT_TRANSIENT` (34) so Buildkite retries the job.
  Only a genuine, non-transient "not found" still returns `undefined` — the
  legitimate pin-unresolvable signal. This fixes both the candidate path (was an
  unretryable bare exit 1 without diagnostics) and the pinned path (a transient
  blip was misclassified as `pin-unresolvable-bumped`, changing the promotion
  outcome).
- Added `TransientError` to `scripts/lib/transient.ts` and taught
  `isTransientError` to recognize it by brand, so buildx-transient signatures
  that the general `TRANSIENT_ERROR_PATTERN` does not list (e.g. `blob unknown`,
  `context deadline exceeded`) still retry.
- Added regression tests: `imageRuntimeFingerprint` throws `TransientError` on a
  transient inspect failure and returns `undefined` on a genuine not-found
  (`bake-images.test.ts`); `isTransientError` honors the `TransientError` brand
  (`transient.test.ts`).
- Rebased the branch onto current `origin/main`.
- Verified: focused Bun tests (all pass), `.buildkite` typecheck, root-scripts
  `typecheck`/`test`/`lint`, buildkite lint, `bun run compliance-check` (all
  packages compliant), Prettier, markdownlint, frozen-lockfile dry-run — all
  clean.

### Remaining

- A fresh Codex re-review runs on the new head; the gate goes green once it
  re-reviews the transient-handling fix and finds no new blocking findings.

### Caveats

- The application-image lane (`bake-images.ts`) has no `runMain` wrapper, so a
  transient inspect failure there now surfaces as a loud hard failure rather
  than a silent wrong promotion — a strict correctness improvement, though it is
  not auto-retried in that lane (out of scope for this finding, which targets
  the CI pin path that does use `runMain`).

### Coverage follow-up (root `//:script-coverage`)

The 2026-08-02 transient fix imported `TransientError` from
`scripts/lib/transient.ts` into `application-image-runtime.ts`, which pulled
`transient.ts` into the `scripts` coverage-measured graph for the first time.
Bun's line-coverage reporter mis-attributes that specific file as `0.00%` lines
(reproduced on the pre-existing `origin/main` version too — it is not caused by
the new class), which dropped the aggregate to 89.46% functions / 86.97% lines
and failed the 90% gate.

Fix: extracted `TransientError` into its own module
`scripts/lib/transient-error.ts` (a class-only file Bun covers correctly at
100%). `application-image-runtime.ts`, `bake-images.test.ts`, and
`transient.test.ts` import the error from there; `transient.ts` imports it for
its `instanceof` brand check. No coverage-graph file imports `transient.ts` any
more, so it leaves the measured set and the aggregate returns to
**95.71% functions / 95.30% lines** (`bun run script-coverage` exits 0 across
all ten packages). Behaviour is unchanged — same class identity, same
`isTransientError` brand recognition.

### Re-review P1 — recheck main after retirement (TOCTOU)

Codex's re-review raised a further **P1**: the auto-merge-enabled pending PR can
merge into `main` after `mainState` was read but during/before
`retireStalePromotion`, so the `content-unchanged` skip could accept a runtime
comparison made against a now-obsolete pin and strand CI on the wrong config
(the pin/state paths are absent from the `ci-base`/`ci-playwright` change
selectors, so no later pin-only build corrects it).

Fix (`update-ci-image-pin.ts`): after any retirement and before returning from
the `content-unchanged` branch, `assertMainPinUnchanged` re-fetches `origin/main`
and re-reads the pin state (`pinStateAtRevision`); if the digest moved from the
`mainState` we compared against, it throws a `TransientError`. Because `promote`
runs under `runMain`, that exits `EXIT_TRANSIENT` (34) and Buildkite retries the
job, which re-clones with fresh `main` and re-compares the candidate against the
current pin (the pending PR is gone by then, so the retry settles).

To satisfy the `max-lines` (500) buildkite-lint rule after these additions, the
GitHub PR-lifecycle helpers (`openOrUpdatePullRequest`, `retireStalePromotion`,
`MONOREPO_REPO`) moved to a new `update-ci-image-pin-github.ts` module; the
orchestrator imports them. That module is not in the `scripts` coverage graph
(nothing imports `update-ci-image-pin.ts`), so coverage is unaffected.

### Re-review P2 — fail loud on unclassified inspect errors

Codex flagged that `imageRuntimeFingerprint`'s catch-all `return undefined`
mapped _every_ non-transient inspect failure to the pin-unresolvable signal,
including registry rate limiting (`429`/`TOOMANYREQUESTS`) that
`bakeFailureIsTransient` did not recognize — so a rate-limited pinned-digest
inspect would open a promotion PR instead of retrying (AGENTS.md L83-L87,
"fail loudly / no defensive fallbacks").

Fix: added `Too Many Requests`/`toomanyrequests` to the transient pattern in
`bake-retry.ts` (rate limits now retry), and split the fallback in
`application-image-runtime.ts` — `undefined` is returned **only** for an
explicitly recognized missing-image response (`IMAGE_ABSENT_PATTERN`:
`not found` / `manifest unknown` / `name unknown`); any other unclassified
failure now throws a plain `Error` (`Unclassified failure inspecting …`) so it
fails loud instead of silently promoting against an unreadable pin. Tests cover
all four outcomes (transient, rate-limit, missing → undefined, unclassified →
throw), plus the rate-limit case in `bake-retry.test.ts`. Coverage stays at
95.71% functions / 95.31% lines.
