---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: PR Review & Checks
---

- `gh pr view --json statusCheckRollup --jq '.statusCheckRollup[].state'` — Extract just the check states as a list.
