---
app: delta
icon: chevron.left.chevron.right
color: "#B07DFF"
website: https://dandavison.github.io/delta
category: New in 0.17.0
---

- Delta now parses git grep and grep output unambiguously by reading color escape sequences from git, eliminating parse errors caused by separator characters in file paths
- This makes piping git grep -W (show full function context) through delta reliable even when paths contain colons or other special characters
