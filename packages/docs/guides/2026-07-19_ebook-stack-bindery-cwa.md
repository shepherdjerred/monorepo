---
id: guide-2026-07-19-ebook-stack-bindery-cwa
type: guide
status: complete
board: false
---

# Ebook stack: Bindery + Calibre-Web Automated + Kindle

Operational reference — infra in PR
[#1581](https://github.com/shepherdjerred/monorepo/pull/1581) / plan
[`plans/2026-07-19_ebook-stack-bindery-cwa.md`](../plans/2026-07-19_ebook-stack-bindery-cwa.md).

## Why this exists

US Kindle Store has almost no 简体中文 catalog. Self-hosted path:

1. Acquire ebooks (Bindery + existing Prowlarr/qBit)
2. Library + convert + EPUB fix (CWA)
3. Deliver to Kindle via Send-to-Kindle email (Postal SMTP)

Official Readarr is retired (2025-06). Bindery is the greenfield replacement;
CWA is the polished library + Auto-Send layer.

## Architecture

```text
Bindery ──Prowlarr Torznab──► qBittorrent
   │                              │
   │ External import              │ /downloads (shared PVC)
   ▼                              │
 /ingest  ◄───────────────────────┘
   │
   ▼
 CWA (poll ingest) → convert/EPUB Fixer → /calibre-library
   │
   └─ Auto-Send SMTP → Postal (postal ns) → you@kindle.com
```

| Component   | Image                                            | Tailscale host | Port | Namespace |
| ----------- | ------------------------------------------------ | -------------- | ---- | --------- |
| Bindery     | `docker.io/vavallee/bindery`                     | `bindery`      | 8787 | `media`   |
| CWA         | `docker.io/crocodilestick/calibre-web-automated` | `cwa`          | 8083 | `media`   |
| Prowlarr    | existing                                         | `prowlarr`     | 9696 | `media`   |
| qBittorrent | existing                                         | `qbittorrent`  | 8080 | `media`   |
| Postal SMTP | existing                                         | —              | 25   | `postal`  |

Versions are pinned with digests in
`packages/homelab/src/cdk8s/src/versions.ts`.

## Storage

| PVC                   | Size   | Class    | Used by                     |
| --------------------- | ------ | -------- | --------------------------- |
| `ebooks-hdd-pvc`      | 50 GiB | ZFS SATA | Bindery + CWA (shared)      |
| `qbittorrent-hdd-pvc` | 1 TiB  | ZFS SATA | qBit + Bindery `/downloads` |
| `bindery-pvc`         | 8 GiB  | ZFS NVMe | Bindery `/config`           |
| `cwa-pvc`             | 8 GiB  | ZFS NVMe | CWA `/config`               |

### Shared books PVC layout

Init containers on both pods create and `chown 1000:1000`:

```text
ebooks-hdd-pvc/
  library/   → Bindery /books (read-only) · CWA /calibre-library (RW)
  ingest/    → Bindery /ingest (RW External dest) · CWA /cwa-book-ingest (RW)
```

**Critical:** Bindery must use **External** (or copy-to-external) import into
`/ingest`. CWA is the sole writer of Calibre `metadata.db` under `library/`.
Bindery’s library mount is **read-only** so a UI misconfig cannot corrupt it.

UID/GID **1000** matches linuxserver qBit/CWA.

## Network / SMTP

Postal SMTP NetworkPolicy allows ingress only from:

- namespace `media` **and**
- pod label `app=cwa`

Not the whole media namespace. CWA pod template carries `app: cwa`.

In-cluster SMTP hostname (from CWA UI):

```text
postal-postal-smtp-service.postal
```

Port `25`, no TLS (cluster-internal), same pattern as Bugsink/Plausible.

## Code map

| File                                                                      | Role                |
| ------------------------------------------------------------------------- | ------------------- |
| `packages/homelab/src/cdk8s/src/resources/torrents/bindery.ts`            | Bindery Deployment  |
| `packages/homelab/src/cdk8s/src/resources/media/calibre-web-automated.ts` | CWA Deployment      |
| `packages/homelab/src/cdk8s/src/cdk8s-charts/media.ts`                    | PVC + wiring        |
| `packages/homelab/src/cdk8s/src/cdk8s-charts/postal.ts`                   | SMTP netpol for CWA |
| `packages/homelab/src/cdk8s/src/versions.ts`                              | Image pins          |

## First-boot operator checklist

Do this once after Argo syncs `media` + `postal`.

### 1. Bindery (`https://bindery.<tailnet>`)

1. Complete first-run admin account.
2. **Download client** → qBittorrent:
   - Host: `http://media-qbittorrent-service:8080` (in-cluster DNS)
   - Creds: existing qBit 1Password item / UI
   - Category optional (e.g. `books`)
3. **Indexers** → Prowlarr Torznab:
   - Base: `http://media-prowlarr-service:9696`
   - API key from Prowlarr Settings → General
   - Prefer book-capable indexers; tag if you use Prowlarr app sync
4. **Library / import**
   - Library root: `/books` (read-only scan of CWA library)
   - Import mode: **External** (or equivalent handoff)
   - External path: **`/ingest`**
5. **Quality** — prefer **EPUB** (Send-to-Kindle converts server-side).
6. Optional: language filter include Chinese / multi-language as needed.
7. Optional: disable telemetry in Settings if desired
   (`BINDERY_TELEMETRY_DISABLED` is not set in-cluster today).

### 2. CWA (`https://cwa.<tailnet>`)

1. Default admin login → **change password immediately**.
2. Confirm library path `/calibre-library` and ingest `/cwa-book-ingest`.
3. CWA Settings:
   - Auto-convert target: **EPUB**
   - **EPUB Fixer** on (Amazon Send-to-Kindle rejection fixes)
   - Auto metadata fetch as preferred
4. **Email / SMTP** (Admin → Edit Mail Server Settings or equivalent):
   - Server: `postal-postal-smtp-service.postal`
   - Port: `25`
   - Encryption: none
   - Username/password: create a **Postal** credential for this sender
   - From address: e.g. `cwa@sjer.red` (must match Postal domain + Amazon allowlist)
5. **Auto-Send to eReader**:
   - Enable; delay after ingest so fixer/metadata finish
   - Destination: your `@kindle.com` / `@free.kindle.com` address
   - Format: EPUB

### 3. Amazon (one-time)

1. Amazon → Account → **Content & Devices** → Preferences →
   **Personal Document Settings**
2. **Approved Personal Document E-mail List** → add the CWA/Postal from-address
3. Note your Send-to-Kindle address for CWA Auto-Send

### 4. Postal credential

1. Postal web UI → create SMTP credential for the from-address domain
2. Enter username/password only in CWA UI (not wired via 1Password today)

### 5. Smoke test

1. Bindery: add one known title → wanted → grab
2. Confirm qBit download completes under shared downloads PVC
3. Confirm file appears in CWA library (ingest processed)
4. Confirm Kindle **Personal Documents** receives the book (Wi‑Fi on device)
5. Open and read on Paperwhite

## Day-2 operations

| Task                | How                                                                               |
| ------------------- | --------------------------------------------------------------------------------- |
| Add author / series | Bindery UI → monitor                                                              |
| Manual drop         | Copy EPUB into CWA ingest (or any path that lands in `ingest/`)                   |
| Metadata fix        | CWA book page → edit; enforcement writes into file                                |
| Resize books PVC    | New larger PVC + copy; 50 GiB is the v1 size                                      |
| Upgrade images      | Renovate bumps `versions.ts` digests                                              |
| Logs                | Loki: `{namespace="media"}` + app labels / pod names `media-bindery`, `media-cwa` |

## Troubleshooting

| Symptom                        | Check                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| Bindery can’t see downloads    | Path mapping vs qBit; both use `/downloads` on `qbittorrent-hdd-pvc` |
| Ingest empty                   | Bindery External path must be `/ingest`; import mode External        |
| CWA never emails               | Postal creds; netpol (pod `app=cwa`); Amazon approved sender         |
| Amazon rejects EPUB            | EPUB Fixer on; try reprocess; check size limits                      |
| Permission denied on books PVC | Init chown 1000; both apps UID 1000                                  |
| Bindery health failing         | Probe is HTTP `GET /api/v1/health` on :8787                          |
| Wrong library writer           | Never set Bindery to import into `/books` RW — mount is RO by design |

## Out of scope (v1)

- Shelfmark (request UI; not under active maintenance)
- Audiobookshelf / Bindery audiobook slot
- Bookshelf / Readarr forks
- Public Cloudflare exposure of Bindery/CWA
- 1Password-wired CWA SMTP secrets (UI-only for now)

## Related

- Plan: [`plans/2026-07-19_ebook-stack-bindery-cwa.md`](../plans/2026-07-19_ebook-stack-bindery-cwa.md)
- Research notes (local): `~/.claude-extra/research/hands-off-ebook-arr-kindle-2026.{md,pdf}`
- Subtitle \*arr guide (separate): [`2026-06-27_arr-stack-subtitle-strategy.md`](2026-06-27_arr-stack-subtitle-strategy.md)
