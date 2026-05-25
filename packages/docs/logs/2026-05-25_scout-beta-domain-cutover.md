# Scout Beta Domain Cutover

## Status

Complete

## Session Log — 2026-05-25

### Done

- Moved Scout beta static-site routing, backend `WEB_APP_ORIGIN`, and CI deploy metadata to `https://beta.scout-for-lol.com`.
- Added the `beta` CNAME in the `scout-for-lol.com` Cloudflare zone and removed the old beta DNS record from the `sjer.red` zone.
- Updated active Scout routing docs to use the new beta hostname and Discord OAuth callback URL.

### Remaining

- Operator step before or during deploy: add `https://beta.scout-for-lol.com/api/auth/discord/callback` to the beta Discord app redirect URI allowlist.
- After Cloudflare DNS apply and ArgoCD sync, run the live URL/OAuth verification from the cutover plan.

### Caveats

- Live DNS, ArgoCD sync, and Discord Developer Portal changes were not performed in this code-only session.
