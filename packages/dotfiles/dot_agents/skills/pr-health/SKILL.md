---
name: pr-health
description: Inspect a PR's merge conflicts, current CI, review status, and next steps. Use for a one-shot health check; use pr-monitor for an ongoing wait.
---

# PR health

In `shepherdjerred/monorepo`, load `monorepo-delivery` for delivery constraints
and use the installed toolkit:

```bash
toolkit pr health [PR] --json
toolkit ci explain [PR] --json
toolkit pr review list [PR] --json
```

Omit the PR number to infer the current branch. Health combines local
merge-tree, exact-head Woodpecker CI, and GitHub metadata. Woodpecker's current
pipeline is authoritative when GitHub summaries lag. The report and
`ci explain` provide commands for deeper logs; use those rather than obsolete
`pr logs` or `pr detect` commands.

Toolkit resolves registered credentials automatically. Authentication setup,
exit codes, and the separate CI credential path live in
`packages/toolkit/README.md`. Report pending work separately from failures and
state which acceptance layers were checked. A health check does not authorize
creating or merging a PR.

For other repositories, inspect the selected PR with native `gh pr view` and
`gh pr checks`, then use that repository's CI provider for logs. Follow its
delivery guidance before making changes.
