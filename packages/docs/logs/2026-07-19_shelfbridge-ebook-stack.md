---
id: log-2026-07-19-shelfbridge-ebook-stack
type: log
status: complete
board: false
---

# ShelfBridge ebook stack — session + post-deploy notes

## Context

GF wants Simplified Chinese ebooks (self-help, translated English bestsellers,
fiction, Rednote/TikTok picks). Bindery + CWA land in #1581; this session added
ShelfBridge (#1587) so Bindery can search LibGen / Anna's Archive / Z-Library
via Torznab and grab webseed torrents through qBittorrent.

## Shipped

| Item           | Ref                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Stacked PR     | [#1587](https://github.com/shepherdjerred/monorepo/pull/1587) (base #1581)                            |
| Plan           | [`plans/2026-07-19_shelfbridge-torznab-ebooks.md`](../plans/2026-07-19_shelfbridge-torznab-ebooks.md) |
| Operator guide | [`guides/2026-07-19_ebook-stack-bindery-cwa.md`](../guides/2026-07-19_ebook-stack-bindery-cwa.md)     |
| 1Password item | `shelfbridge` in vault `Homelab (Kubernetes)` (id `kdre4uvjpjeyaccfhrxfvs5rqy`) — field `API_KEY`     |

## Post-deploy checklist

Do this **after** #1581 and #1587 are merged to `main`, ArgoCD has synced
`media`, and the first main bake has pushed `ghcr.io/shepherdjerred/shelfbridge`
(CI commit-back fills the real `versions.ts` tag@digest — until then the seed
placeholder digest will fail image pull).

### 0. Confirm pods are up

```bash
kubectl -n media get deploy,po,svc -l app=shelfbridge
kubectl -n media get deploy,po -l app=bindery
kubectl -n media get deploy,po -l app=cwa
kubectl -n media logs deploy/media-shelfbridge --tail=50
```

Expect ShelfBridge Ready; logs should not show missing `API_KEY`.

### 1. Sanity-check ShelfBridge Torznab from in-cluster

```bash
KEY=$(op item get shelfbridge --vault "Homelab (Kubernetes)" --fields label=API_KEY --reveal)
kubectl -n media run curl-sb --rm -it --restart=Never --image=curlimages/curl -- \
  "http://media-shelfbridge-service:8787/torznab/api?t=caps&apikey=${KEY}"
```

Expect a `<caps>` XML document. 401 → API key mismatch (re-check the
OnePasswordItem sync / secret key name `API_KEY`).

### 2. Bindery first-run (if not already done from #1581)

UI: `https://bindery.<tailnet>`

1. Create admin account.
2. **Download client** → qBittorrent
   - Host: `http://media-qbittorrent-service:8080`
   - Creds: existing qBit 1Password item / UI
   - Category optional (e.g. `books`)
3. **Library / import**
   - Library root: `/books` (read-only scan of CWA library)
   - Import mode: **External**
   - External path: **`/ingest`**
4. **Quality** — prefer **EPUB**
5. Optional: language filter for Chinese / multi-language; disable telemetry

### 3. Bindery indexers (both)

1. **Prowlarr** (torrent aggregate)
   - Base: `http://media-prowlarr-service:9696`
   - API key: Prowlarr Settings → General
2. **ShelfBridge** (LibGen / Anna's Archive / Z-Library — Chinese leg)
   - URL: `http://media-shelfbridge-service:8787/torznab/api`
   - API key: `API_KEY` from 1Password item `shelfbridge`
   - Categories: `7020` (EBook); add `3030` if using audiobook slots

### 4. CWA + Kindle (if not already done from #1581)

Follow guide sections 2–4: CWA admin password, EPUB + EPUB Fixer, Postal SMTP
(`postal-postal-smtp-service.postal:25`), Auto-Send to `@kindle.com`, Amazon
approved-sender list.

### 5. E2E smoke

| Step            | English path                      | Chinese path                                             |
| --------------- | --------------------------------- | -------------------------------------------------------- |
| Search          | known English title in Bindery    | **原子习惯** (_Atomic Habits_)                           |
| Confirm indexer | Prowlarr / torrent                | **ShelfBridge** hit                                      |
| Grab            | wanted → downloading              | same                                                     |
| qBit            | completes on shared downloads PVC | webseed URL should reference `media-shelfbridge-service` |
| CWA             | appears in library after ingest   | same                                                     |
| Kindle          | Personal Documents (Wi‑Fi on)     | same                                                     |

### 6. If webseed stalls at 0%

qBittorrent runs in gluetun's netns. Outbound to cluster IPs may be dropped.

1. Confirm torrent shows a webseed on `media-shelfbridge-service`.
2. If stuck: add `FIREWALL_OUTBOUND_SUBNETS=<pod/service CIDR>` to the gluetun
   env in `packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts`,
   merge, resync.
3. Re-test the Chinese grab.

### 7. Optional later

- Create a free Z-Library account → add `ZLIB_EMAIL` / `ZLIB_PASSWORD` fields
  on the `shelfbridge` 1Password item + env refs in `shelfbridge.ts` (currently
  anonymous tier only).
- Refresh `ANNAS_MIRRORS` / `LIBGEN_MIRRORS` if upstream domains move (check
  ShelfBridge pod logs for upstream errors).

## Session Log — 2026-07-19

### Done

- Stacked PR #1587 on #1581; image + cdk8s + docs; verify green
- 1Password item + vault snapshot; Bindery-direct Torznab wiring (tofu pivot)
- This log: post-deploy checklist for operators after merge

### Remaining

- Merge order: #1581 → #1587 → wait for image push + Argo sync
- Run post-deploy checklist above (human)
- Gluetun outbound only if E2E webseed fails

### Caveats

- `versions.ts` shelfbridge pin is a placeholder until first main bake
- Z-Lib anonymous limits; AA/LibGen mirrors churn
- Gluetun webseed path unproven until live E2E
