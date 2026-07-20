# Ebook stack: Bindery + CWA + Kindle Auto-Send

## Status

Partially Complete — infra merged to branch; post-deploy operator checklist pending

## Goal

Hands-off ebook pipeline for a US Kindle Paperwhite (incl. 简体 content gap):

```
Bindery → Prowlarr → qBittorrent → CWA ingest → library / Auto-Send → @kindle.com
```

Reuse existing Prowlarr + qBit. No Shelfmark / Audiobookshelf in v1.

## Choices

| Decision         | Value                              |
| ---------------- | ---------------------------------- |
| Acquisition      | Bindery only                       |
| Library + Kindle | CWA + Postal SMTP                  |
| Audiobooks       | Deferred                           |
| Books PVC        | 50 GiB ZFS SATA (`ebooks-hdd-pvc`) |

## Infra

| Resource  | Detail                                                                         |
| --------- | ------------------------------------------------------------------------------ |
| Namespace | `media` (existing chart)                                                       |
| Bindery   | `docker.io/vavallee/bindery:v1.26.2`, port 8787, host `bindery`                |
| CWA       | `docker.io/crocodilestick/calibre-web-automated:v4.0.6`, port 8083, host `cwa` |
| Books PVC | `library/` + `ingest/` subPaths (init mkdir+chown 1000)                        |
| Downloads | Shared `qbittorrent-hdd-pvc`                                                   |
| Postal    | Ingress netpol allows `media` → SMTP :25                                       |

### Path map

| Path                           | Bindery               | CWA             |
| ------------------------------ | --------------------- | --------------- |
| `/config`                      | own NVMe              | own NVMe        |
| `/books` (subPath library)     | library root          | —               |
| `/ingest` / `/cwa-book-ingest` | External handoff dest | ingest          |
| `/calibre-library`             | —                     | Calibre library |
| `/downloads`                   | shared qBit           | —               |

**Import strategy:** Bindery import mode **External** (or copy) → `/ingest` so CWA owns convert/metadata/email. Do not dual-write Calibre `metadata.db`.

## Post-deploy checklist

1. Open `https://bindery.tailnet-…` — admin setup
2. Bindery → download client = in-cluster qBittorrent
3. Bindery → indexers via Prowlarr Torznab (API key)
4. Bindery quality profile prefer EPUB; External path `/ingest`
5. Open `https://cwa.tailnet-…` — default admin login; change password
6. CWA: convert target EPUB, EPUB Fixer on, ingest active
7. CWA Admin → email: SMTP host `postal-postal-smtp-service.postal`, port 25, Postal creds; from-address allowlisted on Amazon
8. Amazon → Content & Devices → Personal Document Settings → approved sender
9. CWA Auto-Send → `you@kindle.com`
10. Smoke: grab one book → CWA library → Kindle Personal Docs

## Files

- `packages/homelab/src/cdk8s/src/resources/torrents/bindery.ts`
- `packages/homelab/src/cdk8s/src/resources/media/calibre-web-automated.ts`
- `packages/homelab/src/cdk8s/src/cdk8s-charts/media.ts`
- `packages/homelab/src/cdk8s/src/cdk8s-charts/postal.ts`
- `packages/homelab/src/cdk8s/src/versions.ts`

## Out of scope

Shelfmark, Audiobookshelf, Bookshelf/Readarr forks, Seerr-for-books, public Cloudflare exposure.

## Session Log — 2026-07-19

### Done

- Worktree `feature/ebook-stack-bindery-cwa` at `.claude/worktrees/ebook-stack-bindery-cwa`
- Deployments: `bindery.ts`, `calibre-web-automated.ts`
- Wired `media.ts` (50 GiB `ebooks-hdd-pvc`) + Postal SMTP netpol allow `media`
- Pinned images in `versions.ts` (Bindery v1.26.2, CWA v4.0.6)
- `bun run typecheck` + `lint` + `build` green in `@homelab/cdk8s`

### Remaining

- Push branch + open PR
- Argo sync media + postal after merge
- Operator checklist (Prowlarr, qBit, CWA SMTP, Amazon allowlist, Auto-Send smoke test)

### Caveats

- CWA SMTP is UI-configured (no 1Password wiring) — create Postal credential manually
- Bindery External path must be set to `/ingest` in UI after first boot
- Bindery HTTP health probe assumes unauthenticated `/api/v1/health`
