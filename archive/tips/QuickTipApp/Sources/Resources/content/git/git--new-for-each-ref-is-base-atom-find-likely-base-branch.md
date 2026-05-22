---
app: Git
icon: arrow.triangle.branch
color: "#F05032"
website: https://git-scm.com
category: New in 2.47
---

- `git for-each-ref --format='%(refname) %(is-base:HEAD)' refs/heads/` — The new `%(is-base:<commit>)` atom reports whether a branch is likely the base that the given commit was branched from, helping scripts identify the parent branch automatically.
