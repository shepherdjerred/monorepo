---
app: bat
icon: doc.text.fill
color: "#FFA657"
website: https://github.com/sharkdp/bat
category: New in v0.26.0
---

- bat now supports negative relative line ranges to print lines from the end of a file
- bat -r :-10 prints everything except the last 10 lines
- bat -r='-10:' prints the last 10 lines
- Combine with positive ranges for flexible slicing of large files
