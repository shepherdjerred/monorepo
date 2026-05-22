---
app: fd
icon: doc.text.magnifyingglass
color: "#89B4FA"
website: https://github.com/sharkdp/fd
category: New in v10.4
---

- `fd --ignore-contain CACHEDIR.TAG` — Skip any directory that contains a CACHEDIR.TAG file, which is the standard marker for cache directories
- The --ignore-contain option was added in v10.4 to skip directories containing a named entry, such as package caches or build artifacts
