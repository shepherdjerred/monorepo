---
id: 2026-08-02-renovate-configuration-issue-investigation
type: log
status: complete
board: false
---

# Renovate configuration issue investigation

## Scope

Investigation and repair of Renovate's open `Action Required: Fix Renovate
Configuration` GitHub issue (#1807), including the live issue payload, the
repository configuration that produced it, and the missing regression guard.

## Finding

Renovate is correctly rejecting the current configuration. The disabled
Playwright package rule in `renovate.json` sets:

```json
"minimumReleaseAge": false
```

The current Renovate schema permits a string duration or `null`; it does not
permit a Boolean. The option is also redundant in this rule: `enabled: false`
already disables Renovate for the two Playwright client packages, and the
default `minimumReleaseAge` is `null`.

The repair removes `minimumReleaseAge` from that rule instead of replacing it
with another override. Renovate documents `"0 days"` as equivalent to `null`,
but retaining an unnecessary option would obscure the rule's actual purpose.

## Origin and impact

- PR #1776 added the rule in merge commit `b30cdb0f9` at
  `2026-07-29T07:09:24Z`.
- Renovate opened [issue #1807](https://github.com/shepherdjerred/monorepo/issues/1807)
  22 seconds later with the exact error
  `packageRules[1].minimumReleaseAge should be a string`.
- At investigation time, the issue remained open with no comments or timeline
  events, and remote `main` still contained the invalid value.
- Renovate states that it stops creating PRs while the error exists. No PR
  authored by `app/renovate` has been created since the issue appeared, and the
  Dependency Dashboard was last updated before the error.

## Why CI missed it

`scripts/renovate-config.test.ts` contains a hand-written partial Zod schema
that explicitly accepts `z.literal(false)` for `minimumReleaseAge`, and its
Playwright test explicitly expects the invalid Boolean. That test is wired into
the root scripts workspace's `test:ci` task, so Buildkite exercised the wrong
contract successfully.

Before the repair:

- `bun test scripts/renovate-config.test.ts`: 4 passed, 0 failed.
- `bun x --package renovate renovate-config-validator renovate.json` failed
  with the same configuration error as issue #1807.
- Renovate's live JSON schema declares the property as `string | null`, default
  `null`; the [official option documentation](https://docs.renovatebot.com/configuration-options/#minimumreleaseage)
  agrees.
- No official Renovate schema validator is present in the repository's verify
  graph; the local Zod model is the only Renovate-config type check found.

## Repair and verification

The implementation removes the invalid property from `renovate.json`, removes
it from the Playwright rule assertion, and narrows the local Zod field to
Renovate's `string | null` contract. This preserves the intended
`enabled: false` behavior while preventing the same Boolean regression.

Post-repair evidence:

- `bun test scripts/renovate-config.test.ts`: 4 passed, 0 failed.
- `bun x --package renovate renovate-config-validator renovate.json`:
  configuration validated successfully.
- `bunx turbo run typecheck test lint --filter=@shepherdjerred/root-scripts`:
  4 Turbo tasks passed, including 460 script tests.

An official Renovate schema validator is still not part of the committed verify
graph. The narrowed Zod contract covers this regression without adding
Renovate's large dependency tree to the monorepo.

## Session Log — 2026-08-02

### Done

- Identified open Renovate action issue #1807 and traced it to
  `renovate.json` in merge commit `b30cdb0f9` (PR #1776).
- Confirmed the failure against current remote `main`, Renovate's live schema,
  official documentation, and `renovate-config-validator`.
- Identified the CI coverage gap: the repository test accepts and asserts the
  invalid value instead of validating Renovate's contract.
- Removed the invalid option and aligned the local Zod schema and Playwright
  rule assertion with Renovate's contract.
- Passed the focused test, official Renovate validator, and root-scripts
  typecheck/test/lint tasks.
- Published draft PR #1950 from the one-layer native GitHub stack at
  `fix/renovate-configuration`.

### Remaining

- None for the requested configuration repair and draft PR publication.

### Caveats

- Renovate issue #1807 will remain open until the fix merges and Renovate runs
  against the corrected default branch.
- The committed regression guard is a focused partial Zod schema; the official
  validator was run for acceptance but is not a new repository dependency.
- Hosted Buildkite and review state are evaluated against the final pushed head
  after this session record is committed.
