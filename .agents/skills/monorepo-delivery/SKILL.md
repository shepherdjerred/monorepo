---
name: monorepo-delivery
description: Deliver changes in this monorepo through Git-Spice, focused checks, Buildkite, automated review, and PR evidence. Use for branches, commits, PRs, CI failures, review findings, or release-readiness claims.
---

# Monorepo delivery

Use `toolkit git-spice` for every feature branch and PR operation. A single PR
is a stack of one. Never use `gs` from non-interactive shells, hand-roll a stack
rebase, or create a feature PR with `gh pr create`.

## Work locally

1. Inspect the current branch, worktree, and complete base diff. Preserve
   unrelated edits.
2. Run focused package tasks with Turbo while iterating.
3. Stage exact paths and run `bunx lefthook run pre-commit`.
4. Commit as `type(scope): outcome`. The primary commit body has `Why`, `What`,
   and `Verification`.
5. Inspect the complete branch diff before submission.

Create or update the PR explicitly:

```bash
toolkit git-spice branch submit --dry-run --title "type(scope): outcome" --body "..."
toolkit git-spice branch submit --title "type(scope): outcome" --body "..."
toolkit git-spice stack submit --update-only
```

Use a draft once the branch has a coherent first commit. Keep the final body
based on the whole branch, not the latest commit.

## Prove readiness

- Buildkite is authoritative for CI. Use `toolkit pr health <PR>` or
  `toolkit bk`; do not infer status from GitHub Actions.
- Verify the exact PR head. A prior build or a green sibling branch is not
  evidence for the current commit.
- Source, CI, artifact publication, ArgoCD deployment, and live behavior are
  separate claims. Report each independently.
- Before pushing a review fix, list the finding and resolve or dismiss its
  thread with a specific audited reason when justified.
- Never change a real gate, skip a test, or suppress an error merely to make a
  PR green.

For a visual change, attach the lightest proof that communicates the behavior.
Upload with `toolkit pr asset <PR> <path> --profile seaweedfs --markdown`.
State unperformed live or production checks in the PR body.

Complex work may use several commits inside this one branch. Use multiple
stacked PRs only when each branch is independently landable and the requested
scope permits more than one PR.
