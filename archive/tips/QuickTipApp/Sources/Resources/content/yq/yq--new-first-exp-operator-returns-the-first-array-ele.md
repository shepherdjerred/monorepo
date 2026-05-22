---
app: yq
icon: doc.text.fill
color: "#CC5DE8"
website: https://mikefarah.gitbook.io/yq
category: New in v4.48
---

Use first(exp) to return the first array element matching an expression — equivalent to select(exp) | head -1 but as a native yq operator: .items | first(.status == "ready")
