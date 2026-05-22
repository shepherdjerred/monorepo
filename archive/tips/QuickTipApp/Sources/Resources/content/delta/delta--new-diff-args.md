---
app: delta
icon: chevron.left.chevron.right
color: "#B07DFF"
website: https://dandavison.github.io/delta
category: New in 0.18.0
---

- Use --diff-args to pass extra arguments directly to the underlying diff command when delta is run in standalone mode (e.g. delta file1 file2 --diff-args="-u --strip-trailing-cr")
- This lets you control diff behavior without losing delta's syntax highlighting and styling
