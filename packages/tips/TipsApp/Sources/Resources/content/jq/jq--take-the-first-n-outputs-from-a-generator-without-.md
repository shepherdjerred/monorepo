---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: Paths & Advanced Features
---

- `limit(3; .[] | select(. > 0))` — Take the first N outputs from a generator without consuming the rest
