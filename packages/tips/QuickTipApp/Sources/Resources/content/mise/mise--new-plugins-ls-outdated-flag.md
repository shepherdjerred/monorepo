---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Run `mise plugins ls --outdated` (or `-o`) to check which asdf-style plugins have newer versions available
- Checks remote git refs in parallel and displays only plugins where the local SHA differs from the remote
- Shows a table with plugin name, URL, ref, local SHA, and remote SHA
- Prints "All plugins are up to date" when everything is current
