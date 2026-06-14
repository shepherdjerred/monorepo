---
app: Git
icon: arrow.triangle.branch
color: "#F05032"
website: https://git-scm.com
category: New in 2.48
---

- `git range-diff --diff-merges=on A...B` — Include merge commits when comparing two commit ranges. Previously `range-diff` skipped merges entirely; now you can audit how merge commits changed between a rebase or rewrite.
