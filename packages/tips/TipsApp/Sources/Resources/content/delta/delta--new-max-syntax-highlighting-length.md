---
app: delta
icon: chevron.left.chevron.right
color: "#B07DFF"
website: https://dandavison.github.io/delta
category: New in 0.18.0
---

- Delta now defaults to skipping syntax highlighting on lines longer than 400 characters to prevent slowdowns on minified or generated files
- Raise or lower the limit with --max-syntax-highlighting-length=N, or set it to 0 to always highlight regardless of line length
