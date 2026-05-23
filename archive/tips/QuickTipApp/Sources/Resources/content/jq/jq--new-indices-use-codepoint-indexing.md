---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: New in 1.8
---

- index/1, rindex/1, and indices/1 now use Unicode code point indexing instead of byte offsets, so they return correct positions for strings containing multi-byte characters like emoji or accented letters
