---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Environment-specific config files now generate their own lockfiles: `mise.test.toml` produces `mise.test.lock` and `mise.local.toml` produces `mise.local.lock`
- CI caches are no longer invalidated by dev-only tool changes since environments that do not set `MISE_ENV` only depend on `mise.lock`
- Old lockfiles with `env` fields are silently accepted and migrated on the next `mise lock`
- This replaces the previous `env` tag system in a shared lockfile
