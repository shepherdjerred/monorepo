---
app: chezmoi
icon: folder.badge.gearshape
color: "#3B82F6"
website: https://www.chezmoi.io
category: Scripts
---

- A run_onchange_ script can react to another file's changes by embedding its hash: # hash: {{ include "other.conf" | sha256sum }}.
