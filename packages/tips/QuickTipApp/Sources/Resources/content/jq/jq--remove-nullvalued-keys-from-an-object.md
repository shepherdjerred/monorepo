---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: Filters & Transformation
---

- `to_entries | map(select(.value != null)) | from_entries` — Remove null-valued keys from an object
