---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.88
---

- List Copilot agent tasks as JSON: gh agent-task list --json id,name,state
- Extract a specific field from a task view using jq: gh agent-task view 1234 --json state --jq '.state'
- Use --template to format the output with Go templates, consistent with other gh commands
