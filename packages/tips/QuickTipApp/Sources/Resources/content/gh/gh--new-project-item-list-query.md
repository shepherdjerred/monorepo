---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.87
---

- Filter project items by a search query: gh project item-list 1 --query "bug"
- Narrows down the list of items in a GitHub Project without fetching everything and filtering locally
- Combine with --format json and jq for scripting against filtered project data
