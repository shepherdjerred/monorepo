---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.88
---

- Clone a fork without automatically adding an upstream remote: gh repo clone owner/repo -- --no-upstream
- By default gh repo clone adds the parent repo as the upstream remote when cloning a fork
- Use --no-upstream when you want to manage remotes manually or do not need the upstream reference
