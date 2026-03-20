---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- `mise prepare` freshness detection now uses blake3 content hashing instead of mtime, making it reliable across CI and clock skew
- Providers can declare dependencies on each other with ordering support
- Use `mise prepare --explain` to see detailed diagnostics about why a provider is or is not running
- Per-provider timeouts are now supported for fine-grained control
- A built-in `git-submodule` prepare provider is included out of the box
