---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- The conda backend has been completely rewritten using the rattler Rust crates, the same engine behind pixi
- Brings a proper SAT-based dependency solver, correct binary prefix replacement, and repodata caching via CDN
- Install conda packages with `mise use conda:postgresql` and only the main package binaries appear on PATH (not transitive dependencies)
- Transitive dependency binaries remain installed internally but are hidden from PATH to prevent shadowing system commands
