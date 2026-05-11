# update-versions.ts: handle same-line entries safely

## Status

Complete

## Problem

PR #755 (auto-generated `chore: bump pending image versions`) produced invalid TypeScript in
`packages/homelab/src/cdk8s/src/versions.ts`. The closing `};` of the `versions` object was
overwritten with the new digest line for `shepherdjerred/trmnl-dashboard`:

```ts
  "shepherdjerred/trmnl-dashboard": "latest",
"2.0.0-2097@sha256:a35e0d2a6e7fc97f1a2f3014c368d8784177cf32824cb3972511145a8aaf9165",   // ← was `};`
```

## Root cause

`.buildkite/scripts/update-versions.ts` assumed every entry it touched was multi-line — key on
line N, value on line N+1 — and blindly overwrote line N+1. Every other shepherdjerred entry
happens to be multi-line, but `trmnl-dashboard` is on a single line:

```ts
"shepherdjerred/trmnl-dashboard": "latest",
```

So when the bot tried to update it, it overwrote the next line (`};`) instead.

## Fix

`.buildkite/scripts/update-versions.ts` now:

1. Detects same-line entries (`"key": "value",`) via regex and replaces the value in place.
2. For multi-line entries, validates the next line really matches `^\s*"…"\s*,?\s*$` before
   overwriting it; otherwise exits with an error rather than silently corrupting the file.

| Case                                | Behavior before         | Behavior after                   |
| ----------------------------------- | ----------------------- | -------------------------------- |
| `"key":\n  "value",` (multi-line)   | Overwrites next line    | Overwrites next line (validated) |
| `"key": "value",` (single-line)     | Clobbers the line below | Replaces value in place          |
| Next line is `};` or unrelated code | Silent corruption       | Hard error, exits 1              |

## Verification

Ran the fixed script against a copy of `versions.ts` with three keys covering each shape:

- `shepherdjerred/scout-for-lol` (multi-line `/beta` entry) → updated correctly
- `shepherdjerred/birmel` (multi-line, no suffix) → updated correctly
- `shepherdjerred/trmnl-dashboard` (single-line) → value replaced, `};` preserved

Diff against original confirmed only the three intended value lines changed, no structural
damage. `bunx tsc --noEmit` in `packages/homelab/src/cdk8s` reported no errors with the
updated file.

## Remaining

PR #755's working file on the `chore/version-bump-pending` branch is still broken. Two
options:

1. Close the PR — the next commit-back run after this fix lands will regenerate it correctly.
2. Manually push a fix-up commit replacing line 241 with the real value and restoring `};`.

User to decide which path.

## Session Log — 2026-05-10

### Done

- `.buildkite/scripts/update-versions.ts`: rewrote inner loop to handle same-line entries and
  validate multi-line replacements before overwriting.
- Verified end-to-end against a copy of `packages/homelab/src/cdk8s/src/versions.ts` with
  three differently-shaped keys; no structural damage, types still clean.

### Remaining

- Decide whether to close PR #755 (auto-regenerates with fixed script) or push a fix-up
  commit to the broken branch.

### Caveats

- The fix relies on `versions.ts` continuing to use either `"key": "value",` or `"key":\n
"value",` shapes. If a future entry uses a different shape (e.g. trailing comments on the
  value line), the multi-line `VALUE_LINE_RE` would reject it and fail loudly, which is the
  intended behavior — better to fail fast than silently corrupt the file.
