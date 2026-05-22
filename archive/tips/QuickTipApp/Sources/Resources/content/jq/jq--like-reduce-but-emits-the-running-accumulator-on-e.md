---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: Control Flow & Error Handling
---

- `foreach .[] as $x (0; . + $x; .)` — Like `reduce` but emits the running accumulator on each step
