---
app: delta
icon: chevron.left.chevron.right
color: "#B07DFF"
website: https://dandavison.github.io/delta
category: New in 0.18.0
---

- Delta now correctly parses quoted file paths in hunk headers, fixing display issues when diffing files whose names contain spaces or special characters
- Previously, git would quote such paths in the diff output and delta would show the raw quotes instead of the clean filename
