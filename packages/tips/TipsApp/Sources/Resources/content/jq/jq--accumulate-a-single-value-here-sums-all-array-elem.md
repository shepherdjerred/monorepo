---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: Control Flow & Error Handling
---

- `reduce .[] as $x (0; . + $x)` — Accumulate a single value; here sums all array elements
