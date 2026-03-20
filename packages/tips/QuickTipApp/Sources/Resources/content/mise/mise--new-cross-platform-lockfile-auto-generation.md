---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- When you install a tool, mise now automatically locks versions for all platforms, not just your current OS
- Your `mise.lock` stays complete for teammates on different operating systems without needing to run `mise lock` separately on each platform
- Use `--locked` flag with `mise install` for strict lockfile mode that refuses to install anything not already in the lockfile
- Multi-platform checksums are recorded without downloading tarballs for every platform
