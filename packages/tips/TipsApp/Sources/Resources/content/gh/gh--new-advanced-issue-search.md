---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.79
---

- Use GitHub advanced issue search syntax directly in the CLI: gh search issues "is:open label:bug no:assignee"
- Works for pull requests too: gh search prs "is:open review:required author:@me"
- Pass advanced filters to the list commands as well: gh issue list --search "label:bug no:assignee"
