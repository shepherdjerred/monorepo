---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: Filters & Transformation
---

- `.[] | select(.active == true)` — Filter a stream; `select` passes through values where the condition is truthy
