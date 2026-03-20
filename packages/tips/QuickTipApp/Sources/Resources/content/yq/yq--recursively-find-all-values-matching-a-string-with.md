---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Selection & Filtering
---

- `yq '.. | select(. == "debug")' file.yaml` — Recursively find all values matching a string with `..`
