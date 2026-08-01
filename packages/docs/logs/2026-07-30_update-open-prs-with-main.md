---
id: 2026-07-30-update-open-prs-with-main
type: log
status: in-progress
board: false
---

# Update Open Pull Requests with Main

## Request

Update every open pull request in `shepherdjerred/monorepo` with current
`main`.

## Approach

- Enumerate the live open-PR fleet, including drafts and automation-authored
  pull requests.
- Preserve git-spice stack topology for user-authored feature branches.
- Avoid repository-global sync from the dirty shared main checkout.
- Use GitHub's update-branch operation for automation-authored branches that
  are outside the local git-spice workflow.
- Verify every final PR head contains the current `main` commit, directly for
  main-based PRs and transitively through each stacked base.

## Session Log — 2026-07-30

### Done

- Loaded the repository git-spice, GitHub, Git/worktree, and documentation
  guidance.
- Enumerated 33 open pull requests: 30 user-authored and 3
  automation-authored.

### Remaining

- [ ] Audit open-PR worktree cleanliness and local/remote branch alignment.
- [ ] Restack and submit every eligible git-spice stack against current
      `main`.
- [ ] Update automation-authored pull request branches.
- [ ] Verify all final PR heads contain the current `main` commit.

### Caveats

- The main checkout already contained unrelated untracked files before this
  session, so repository-global git-spice mutation from it is unsafe.
