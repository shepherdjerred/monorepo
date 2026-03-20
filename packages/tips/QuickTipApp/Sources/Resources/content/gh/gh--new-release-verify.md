---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.81
---

- Verify the latest release has a valid GitHub attestation: gh release verify
- Verify a specific release by tag: gh release verify v1.2.3
- Verify a downloaded asset came from a specific release: gh release verify-asset v1.2.3 my-asset.zip
- Part of the Immutable Releases initiative; provides a signed, timestamped binding between a release and its assets
