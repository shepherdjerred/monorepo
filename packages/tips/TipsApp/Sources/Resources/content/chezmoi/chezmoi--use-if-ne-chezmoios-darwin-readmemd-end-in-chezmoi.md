---
app: chezmoi
icon: folder.badge.gearshape
color: "#3B82F6"
website: https://www.chezmoi.io
category: External Files & Ignoring
---

- Use {{ if ne .chezmoi.os "darwin" }}README.md{{ end }} in .chezmoiignore to ignore files conditionally per OS.
