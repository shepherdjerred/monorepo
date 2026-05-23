---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Selection & Filtering
---

- `yq '.[] | select(.env == "prod")' file.yaml` — Filter array elements by a condition
