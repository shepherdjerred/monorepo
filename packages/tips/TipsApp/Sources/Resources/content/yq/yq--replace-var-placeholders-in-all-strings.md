---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Environment & Scripting
---

- `yq '(.. | select(tag == "!!str")) |= envsubst' file.yaml` — Replace `${VAR}` placeholders in all strings
