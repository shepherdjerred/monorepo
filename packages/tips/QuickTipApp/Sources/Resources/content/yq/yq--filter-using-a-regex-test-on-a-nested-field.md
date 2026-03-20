---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: Selection & Filtering
---

- `yq '.[] | select(.name | test("^api-"))' file.yaml` — Filter using a regex test on a nested field
