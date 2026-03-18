---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.86
---

- Delete all caches for a specific branch ref: gh cache delete --ref refs/heads/my-branch
- Previously cache delete only accepted a cache key or --all; now you can target a whole ref at once
- Useful for clearing stale caches after rebasing or force-pushing a branch
