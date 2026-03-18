---
app: Git
icon: arrow.triangle.branch
color: "#F05032"
website: https://git-scm.com
category: New in 2.48
---

- `git fetch` now automatically creates or updates `refs/remotes/<remote>/HEAD` when it is missing and the remote advertises a default branch. Set `remote.<name>.followRemoteHEAD = warn` or `always` to control the behavior explicitly.
