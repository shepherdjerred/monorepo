---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Merging & Combining
---

- `yq ea '. as $item ireduce ({}; .  $item)' .yaml` — Merge all YAML files in a directory into one
