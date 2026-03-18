---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Environment variables marked with `redact = true` in `mise.toml` are automatically hidden in `mise set` output
- Variables matching patterns in the `redactions` setting are also hidden
- Use `mise set --no-redact` to reveal redacted values when you need to inspect them
- Secret values correctly appear as `[redacted]` even when combined with `tools = true` directives
