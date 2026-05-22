---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Selection & Filtering
---

- `yq 'del(.[] | select(. == "old"))' file.yaml` — Delete array elements matching a condition
