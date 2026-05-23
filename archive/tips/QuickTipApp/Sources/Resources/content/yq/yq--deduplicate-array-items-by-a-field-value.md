---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: String & Array Operations
---

- `yq '.items |= unique_by(.id)' file.yaml` — Deduplicate array items by a field value
