---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Merging & Combining
---

- `yq '. ? load("patch.yaml")' file.yaml` — Merge only existing fields (skip new keys) with `?`
