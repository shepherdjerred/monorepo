---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.88
---

- Filter files out of a PR diff with the --exclude flag: gh pr diff --exclude "\*.lock"
- Exclude multiple patterns by repeating the flag: gh pr diff --exclude "\*.lock" --exclude "vendor/\*\*"
- Useful for reviewing large PRs where generated or dependency files clutter the diff
