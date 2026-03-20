---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Selection & Filtering
---

- `yq '.items[] | select(.replicas > 1) |= .replicas -= 1' file.yaml` — Select and update matching items in one expression
