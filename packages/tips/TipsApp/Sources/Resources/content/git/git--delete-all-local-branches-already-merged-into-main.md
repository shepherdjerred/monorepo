---
app: Git
icon: arrow.triangle.branch
color: "#F05032"
website: https://git-scm.com
category: Branching & Worktrees
---

- `git branch --merged main | grep -v main | xargs git branch -d` — Delete all local branches already merged into main in one pass.
