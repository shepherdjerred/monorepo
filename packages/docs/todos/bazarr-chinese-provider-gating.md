---
id: bazarr-chinese-provider-gating
type: todo
status: planned
board: true
verification: operator
disposition: active
origin: packages/docs/archive/superseded/2026-06-27_bazarr-subtitles-chinese-gating.md
source_marker: false
---

# Gate Chinese subtitle acquisition by Seerr user/tag

Configure the live Seerr/Sonarr/Radarr/Bazarr chain so Chinese subtitle profiles
apply only to requests from the intended user/tag, without changing default
subtitle behavior for other users.

## Remaining

- [ ] Identify the target Seerr user/tag and document the tag propagation path into Sonarr/Radarr and Bazarr.
- [ ] Obtain/store any paid provider credentials in 1Password and configure providers through authorized operator access.
- [ ] Create the Chinese language/profile rules and bind them only to the propagated tag.
- [ ] Test one tagged and one untagged request through the full live chain, recording selected profiles and downloaded languages.
- [ ] Document rollback and credential-rotation steps without recording secrets.

## Comment Log

- 2026-07-27 — Split from the mixed Bazarr plan because this work is almost
  entirely privileged live configuration and may require paid credentials.
  Verification is operator-owned rather than presented as human UAT.
