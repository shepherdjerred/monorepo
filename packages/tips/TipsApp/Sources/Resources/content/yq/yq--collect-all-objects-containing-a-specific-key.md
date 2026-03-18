---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Selection & Filtering
---

- `yq '[.. | select(has("name"))]' file.yaml` — Collect all objects containing a specific key
