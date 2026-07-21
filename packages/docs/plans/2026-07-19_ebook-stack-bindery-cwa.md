# Ebook stack: Bindery + CWA + Kindle Auto-Send

## Status

Partially Complete — code on
[PR #1581](https://github.com/shepherdjerred/monorepo/pull/1581); post-merge
operator setup pending.

**Operator runbook (canonical):**
[`guides/2026-07-19_ebook-stack-bindery-cwa.md`](../guides/2026-07-19_ebook-stack-bindery-cwa.md)

## Goal

Hands-off ebook pipeline for a US Kindle Paperwhite (incl. 简体 content gap):

```text
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

| Resource  | Detail                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------- |
| Namespace | `media` (existing chart)                                                                            |
| Bindery   | `docker.io/vavallee/bindery:v1.26.2`, port 8787, host `bindery`, pod label `app=bindery`            |
| CWA       | `docker.io/crocodilestick/calibre-web-automated:v4.0.6`, port 8083, host `cwa`, pod label `app=cwa` |
| Books PVC | `library/` + `ingest/` subPaths (init mkdir+chown 1000)                                             |
| Downloads | Shared `qbittorrent-hdd-pvc`                                                                        |
| Postal    | SMTP ingress: namespace `media` **and** pod `app=cwa` only                                          |

### Path map

| Path                           | Bindery                      | CWA             |
| ------------------------------ | ---------------------------- | --------------- |
| `/config`                      | own NVMe                     | own NVMe        |
| `/books` (subPath library)     | library root (**read-only**) | —               |
| `/ingest` / `/cwa-book-ingest` | External handoff dest (RW)   | ingest (RW)     |
| `/calibre-library`             | —                            | Calibre library |
| `/downloads`                   | shared qBit                  | —               |

**Import strategy:** Bindery import mode **External** → `/ingest` so CWA owns
convert/metadata/email. Library mount is read-only to prevent dual writers on
`metadata.db`.

## Post-deploy checklist (summary)

Full steps: [operator guide](../guides/2026-07-19_ebook-stack-bindery-cwa.md).

1. Argo sync `media` + `postal`
2. Bindery: qBit + Prowlarr; External → `/ingest`; prefer EPUB
3. CWA: EPUB Fixer; SMTP → `postal-postal-smtp-service.postal:25`
4. Amazon approved Personal Document sender
5. CWA Auto-Send → `@kindle.com`
6. Smoke test one book → Kindle Personal Docs

## Files

- `packages/homelab/src/cdk8s/src/resources/torrents/bindery.ts`
- `packages/homelab/src/cdk8s/src/resources/media/calibre-web-automated.ts`
- `packages/homelab/src/cdk8s/src/cdk8s-charts/media.ts`
- `packages/homelab/src/cdk8s/src/cdk8s-charts/postal.ts`
- `packages/homelab/src/cdk8s/src/versions.ts`
- `packages/docs/guides/2026-07-19_ebook-stack-bindery-cwa.md`

## Out of scope

Shelfmark, Audiobookshelf, Bookshelf/Readarr forks, Seerr-for-books, public
Cloudflare exposure, 1Password-wired CWA SMTP.

## Session Log — 2026-07-19

### Done

- Worktree `feature/ebook-stack-bindery-cwa`
- Deployments Bindery + CWA; 50 GiB books PVC; Postal SMTP scoped to `app=cwa`
- Bindery library mount read-only; pod labels for netpol
- Image pins Bindery v1.26.2, CWA v4.0.6
- Operator guide under `packages/docs/guides/`
- PR #1581

### Remaining

- CI green + merge
- Argo sync media + postal
- Operator checklist (see guide)

### Caveats

- CWA SMTP is UI-configured (Postal credential manual)
- Bindery External path must be `/ingest` after first boot
- Bindery health probe: unauthenticated `GET /api/v1/health`
