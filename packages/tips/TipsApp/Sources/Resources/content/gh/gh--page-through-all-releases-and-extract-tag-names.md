---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: API & Scripting
---

- `gh api --paginate repos/{owner}/{repo}/releases --jq '.[].tag_name'` — Page through all releases and extract tag names.
