---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- `mise lock` now records which provenance mechanism (SLSA, GitHub attestations, cosign, or minisign) was used to verify each tool per platform
- On subsequent installs, mise refuses to proceed if the recorded verification mechanism is disabled or unavailable, protecting against downgrade attacks
- The lockfile format uses dotted-key subtables for platform entries, improving readability
- Existing lockfiles remain backwards-compatible and update on the next `mise lock`
