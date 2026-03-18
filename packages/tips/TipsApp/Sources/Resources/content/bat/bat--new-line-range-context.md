---
app: bat
icon: doc.text.fill
color: "#FFA657"
website: https://github.com/sharkdp/bat
category: New in v0.26.0
---

- bat now supports context lines in line ranges so you can see surrounding lines
- bat -r 30::5 shows line 30 with 5 lines of context above and below
- bat -r 30:40:5 shows lines 30-40 with 5 lines of context around the range
- Great for inspecting a specific area of code without losing surrounding context
