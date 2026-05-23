---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.81
---

- Output authentication status as JSON for scripting: gh auth status --json
- Combine with jq to extract a specific field: gh auth status --json | jq '.token'
- Useful in CI scripts that need to check or validate the active GitHub token programmatically
