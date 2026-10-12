---
name: pr-workflow-automation
description: Deliver authorized PR changes and repair review or CI blockers. Use when asked to create, update, or merge a PR; use pr-monitor for watching an existing PR.
---

# PR workflow automation

In `shepherdjerred/monorepo`, load `monorepo-delivery` and follow it for
branches, commits, submission, verification, and review fixes. Use
`toolkit git-spice`; a single PR is a stack of one. Toolkit resolves registered
credentials automatically; setup and the separate CI credential path live in
`packages/toolkit/README.md`.

Create or merge a PR only within the user's authorization. Preserve unrelated
changes, stage explicit paths, and keep the PR's Why, What, and Verification
based on the complete branch diff. Respect requested monitoring boundaries;
when waiting is requested, use `toolkit ci wait [PR] --json`. Inspect blockers
with `toolkit ci explain [PR]` and provider feedback with
`toolkit pr review list [PR] --json`. Follow the delivery skill for repairs
and audited thread resolution before publishing.

For an authorized merge, use `toolkit git-spice branch merge --method squash`.
If the user requests an immediate attempt without waiting, add
`--ready-timeout 0`; this checks once and preserves the repository's gates.
Report the actual merge result and any unverified CI or deployment layers.

When explicitly asked to operate the complete open PR fleet, use the
foreground `bun run pr:fleet --model <provider>/<model-id>` controller. Its
dashboard is read-only; the controller may repair and publish branches but
may not merge, close, or approve PRs. See
`packages/pr-fleet-controller/README.md` for dashboard and private run-bundle
inspection/replay commands. Do not start fleet work for a single-PR request.

For other repositories, follow their branch, CI, and review procedures using
the provider's native CLI. Repair observed failures within scope; repeated
failure requires investigating the constraint rather than blind retries.
