---
name: pr-monitor
description: Monitor an existing PR's CI, reviews, and merge conflicts in the foreground until ready or an actionable blocker appears. Use when asked to watch or monitor a PR.
---

# PR monitoring

In `shepherdjerred/monorepo`, load `monorepo-delivery` before delivery or
repair work. Use one foreground wait pinned to the PR head:

```bash
toolkit ci wait [PR] --json
```

Keep awaiting that same process. Long queues and builds are normal. On an
actionable blocker, inspect bounded evidence with `toolkit ci explain [PR]`
and reviews with `toolkit pr review list [PR] --json`. Use `toolkit ci load`
for capacity. Command details, credentials, and exit meanings live in
`packages/toolkit/README.md`.

If repairs are within the user's scope, address the actual failure, run focused
local checks, resolve provider findings with an audited reason, and publish
through `toolkit git-spice`. Start a new wait explicitly after the head changes.
Follow `monorepo-delivery` for conflicts and branch updates; being behind main
alone does not mean there is a conflict or that a rebase is required.

Respect the user's requested wait boundary. A timeout is not a CI failure;
red main requires reporting and awaiting instructions. Report human
intervention when required by effective merge rules or requested changes;
do not invent an approval requirement. Monitoring does not authorize creating
or merging a PR. Never promise to resume after the turn ends.

For other repositories, follow their delivery guidance, monitor the native CI
provider in the foreground, and inspect review and conflict state with `gh`.
