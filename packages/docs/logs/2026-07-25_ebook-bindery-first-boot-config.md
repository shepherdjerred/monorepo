---
id: log-ebook-bindery-first-boot-config-2026-07-25
type: log
status: in-progress
board: false
---

# Ebook stack first-boot config — Bindery done via API, CWA deferred

Operator first-boot configuration for the ebook stack (guide:
[`guides/2026-07-19_ebook-stack-bindery-cwa.md`](../guides/2026-07-19_ebook-stack-bindery-cwa.md)).
Infra was already deployed & healthy (all pods `Running 1/1` in `media`). This
session did the **first-boot operator config** entirely over the Bindery HTTP
API. CWA config was deferred at the user's request.

## Access notes (for resuming)

- **Bindery**: `https://bindery.tailnet-1a49.ts.net` — auth via `X-Api-Key`
  header. Admin creds + API key stored in **1P Personal → "Bindery"**.
  API base `/api/v1`. Distroless image (no shell in pod).
- **CWA**: `https://cwa.tailnet-1a49.ts.net` — Flask/Calibre-Web, session +
  `csrf_token` form auth. Admin password **changed off the default** and stored
  in **1P Personal → "Calibre-Web Automated (CWA)"** (user `admin`). Profile form
  is `/me`; SMTP config is under admin settings.
- **qBittorrent** creds: 1P `Homelab (Kubernetes)/qBittorrent` (`jerred` / pw).
  NOTE: `op read "op://Homelab (Kubernetes)/..."` returns empty (vault name has
  spaces/parens) — use `op item get <item> --vault "Homelab (Kubernetes)" --fields <f> --reveal`.
- **ShelfBridge** API key: 1P `Homelab (Kubernetes)/shelfbridge` → `API_KEY`.
- **Prowlarr** API key: read from pod `kubectl exec -n media <prowlarr-pod> -- cat /config/config.xml`.

## Bindery — DONE (all via API)

| Item                           | Detail                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin account                  | `POST /auth/setup` → user `jerred`; creds+apiKey in 1P Personal "Bindery"                                                                                                                                  |
| Download client                | qBittorrent (id 1), host `media-qbittorrent-service:8080`, user `jerred`, category `books`, **enabled** (field is `enabled` not `enable`); test "Connection verified"                                      |
| Prowlarr app                   | `POST /prowlarr` (id 1), url `http://media-prowlarr-service:9696`; test OK (v2.4.0.5397); sync added 3 indexers (AnimeZ, Knaben, The Pirate Bay)                                                           |
| ShelfBridge indexer            | `POST /indexer` (id 4), type `torznab`, url `http://media-shelfbridge-service:8787/torznab/api`, apiKey from 1P, categories `[7020]`; test returned `bookSearch:true, searchResults:39` (Chinese leg live) |
| Root folder                    | `POST /rootfolder` `/books` (id 1); freeSpace ~50 GiB confirms ebooks-hdd-pvc                                                                                                                              |
| Drop folder (External handoff) | `setting calibre.drop_folder_path = /ingest` — Bindery renames finished downloads here for CWA, source never moved (keeps seeding)                                                                         |
| CWA ingest path                | `setting cwa.ingest_path = /ingest`                                                                                                                                                                        |
| Calibre mode                   | `calibre.mode = off` (values: off/calibredb/plugin) — CWA stays sole writer of the Calibre DB; Bindery never writes `/books` (RO mount)                                                                    |

### Bindery API cheatsheet (learned this session)

- Auth: `GET /auth/csrf` (first-run setup was CSRF-exempt) → `POST /auth/setup {username,password}` → `GET /auth/config` returns `apiKey`.
- All resources: `X-Api-Key` header. `PUT /setting/{key} {value}`; `GET /setting` returns a **list** of `{key,value}`.
- `downloadclient` flat shape: `{name,type:"qbittorrent",enabled,host,port,useSsl,username,password,category,priority}`. `/downloadclient/test` (no id) validates.
- `prowlarr` shape: `{name,url,apiKey,enabled}` (field is `url`, not `baseUrl`); test/sync are per-id: `/prowlarr/{id}/test`, `/prowlarr/{id}/sync`.
- `indexer` torznab shape: `{name,type:"torznab",url,apiKey,categories:[int],priority,enabled,supportsSearch}`.
- Quality profiles pre-seeded: `Any`(1), `E-Book`(2), `Audiobook`(3) — pick `E-Book` when adding books.

## Simplified Chinese acquisition — SOLVED (Google Books metadata)

**Problem:** Bindery is metadata-first. "Add Book" hits `/search/book` against a
metadata provider _before_ touching indexers. Default providers are OpenLibrary +
DNB (the "Primary metadata provider" setting only toggles between those two);
neither indexes 简体中文 titles, so 原子习惯 → "No results found" and Bindery never
searches ShelfBridge (which _does_ have the file — raw Torznab returns 39 hits).

**Root cause found in source** (`vavallee/bindery`, MIT, Go): `SearchBooks` already
fans out to primary + every enricher, and a **Google Books provider is already
implemented** (`internal/metadata/googlebooks/`, works keyless but gated). main.go
only wires it as an enricher **if `googlebooks.apiKey` is set** (empty by default).
Keyless Google Books hits an exhausted shared quota (429), which is why it's gated.

**Fix (no fork — config only):**

1. Created a Google Books API key in the **`gen-lang-client-0890916842`** GCP
   project (enabled Books API, key "Bindery Books API", restricted to Books API).
   Key stored in **1P Personal → "Bindery"** field `Google Books API Key`.
2. `PUT /setting/googlebooks.apiKey` = the key.
3. Relaxed metadata profile 1 `allowedLanguages`: `eng` → **`eng,chi,zho`**.
4. Restarted the Bindery pod (key is read at boot; `kubectl rollout restart
deployment/media-bindery` — note Kyverno admission controller was crashlooping
   and blocked the first patch, retried while it was up). Logs confirm
   **"google books enrichment enabled"**.

**Verified:** `/search/book?term=原子习惯` → 18 results incl. 原子習慣 (詹姆斯•克利爾,
`googlebooks`); 活着 → 22; 三体 → 22. The metadata gate is broken; the full
Chinese chain (Bindery add → ShelfBridge grab → CWA) is now unblocked on the
metadata side.

## CWA — DEFERRED (needs Kindle-account decision)

CWA is still on default creds and unconfigured for email. Deferred because the
Kindle is **not on the user's Amazon account**, so the send-to-Kindle destination
and the Amazon approved-sender step depend on whoever owns that account.

Remaining CWA steps (all account-independent except the last two):

1. ~~Change admin password~~ **DONE** — resubmitted full `/me` form (35 fields,
   preserving all values) with new password; verified old fails / new works;
   stored in 1P Personal "Calibre-Web Automated (CWA)".
2. Create a **Postal SMTP credential** for the from-address (`cwa@sjer.red` proposed). Confirm Postal serves `sjer.red` domain first. Credential creation is Postal web-UI/console (`postal` tailscale host); no clean REST for cred creation → pinchtab or rails console in `postal-postal-web` pod.
3. CWA admin SMTP settings: server `postal-postal-smtp-service.postal`, port `25`, no encryption, the Postal username/password, from `cwa@sjer.red`.
4. CWA settings: auto-convert target **EPUB**, **EPUB Fixer on**.
5. `/me` form: set `kindle_mail` = the `@kindle.com` address + check `auto_send_enabled`.
6. **Amazon** (on the Kindle's account): add `cwa@sjer.red` to Personal Document approved-sender list; grab the `@kindle.com` address.

CWA `/me` form field names (confirmed this session): `name, email, password,
kindle_mail, kindle_mail_subject, allow_additional_ereader_emails (checked),
auto_send_enabled (unchecked), locale, default_language, theme, hardcover_token,
show_* checkboxes`. Form posts to `/me` with `csrf_token`.

## Session Log — 2026-07-25

### Done

- Verified stack deployed & healthy (bindery/cwa/shelfbridge pods Running 1/1).
- Fully configured **Bindery** via API: admin account, qBittorrent download
  client (enabled), Prowlarr app (+3 synced indexers), ShelfBridge Torznab
  indexer (39 results / Chinese leg live), root folder `/books`, drop folder →
  `/ingest`, `calibre.mode=off`. Creds in 1P Personal "Bindery".
- Changed **CWA** admin password off the default `admin123`; stored in 1P
  Personal "Calibre-Web Automated (CWA)". Rest of CWA (SMTP/auto-send) deferred.

### Remaining

- **CWA** (deferred): change admin password off default; Postal SMTP credential;
  CWA SMTP + EPUB auto-convert/fixer; `kindle_mail` + auto-send; Amazon
  approved-sender. See CWA section above for exact steps/field names.
- **Smoke test** (after CWA): Bindery add a title → qBit download → CWA ingest →
  Kindle receives. Plus Chinese E2E via ShelfBridge (e.g. 原子习惯).

### Caveats

- Kindle is **not on the user's Amazon account** — send-to address + approved
  sender must be done on the account the Kindle is registered to.
- `calibre.drop_folder_path` and `cwa.ingest_path` both set to `/ingest` (unclear
  which Bindery actually reads for the CWA handoff; both point at the real dir CWA
  watches, so harmless). Verify handoff works during the smoke test.
- Bindery quality left at pre-seeded `E-Book` profile default (no explicit
  EPUB-only enforcement); CWA auto-converts to EPUB anyway.
