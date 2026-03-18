---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: Array & Object Builtins
---

- `group_by(.category) | map({category: .[0].category, count: length})` — Group and aggregate in one pipeline
