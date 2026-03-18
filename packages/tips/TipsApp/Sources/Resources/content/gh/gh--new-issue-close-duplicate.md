---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.88
---

- Close an issue as a duplicate and link to the original: gh issue close 123 --duplicate-of 456
- Close with the duplicate reason but without linking a specific issue: gh issue close 123 --reason duplicate
- The closed issue gets marked as a duplicate on GitHub just as if you had done it from the web UI
