---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Use `mise ls-remote <tool> --before <date>` to list only tool versions released before a specific date
- Supports calendar units in relative durations, such as `--before "6 months ago"` or `--before "2025-01-01"`
- Useful for pinning a project to versions available at a known point in time, or for auditing what was available when a bug was introduced
- The `--json` flag on `mise ls-remote` now includes `created_at` timestamps for supported backends
