---
app: fd
icon: doc.text.magnifyingglass
color: "#89B4FA"
website: https://github.com/sharkdp/fd
category: New in v10.4
---

- Since v10.4, combining --print0 with --exec prints a null byte between the output of each entry, making it safe to pipe exec output to tools that support null-delimited input
- Example: fd --print0 -x wc -l | xargs -0 processes each count output separated by null bytes
