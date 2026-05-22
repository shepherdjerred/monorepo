---
app: jq
icon: curlybraces
color: "#B5BD68"
website: https://jqlang.github.io/jq
category: New in 1.7
---

- Dot notation is now allowed between bracket indexes, so .a.["b"].c is valid and equivalent to .a["b"].c, making it easier to chain mixed key styles when navigating nested structures
