---
id: plan-2026-07-19-shelfbridge-torznab-ebooks
type: plan
status: complete
board: false
---

# ShelfBridge Torznab leg for the ebook stack

## Goal

PR #1581 delivers Bindery + CWA + shared volumes, but Bindery's only
acquisition path is torrent/Usenet indexers, where Chinese-language ebooks are
essentially absent. ShelfBridge (`selmant/shelfbridge`) exposes **LibGen,
Anna's Archive, and Z-Library** as a Torznab indexer with webseed `.torrent`
grabs, so the existing Bindery → Prowlarr/qBit → CWA pipeline can fetch
Chinese titles (translated English bestsellers, self-help, fiction) with no
separate toolchain.

## Design decisions

- **Build our own image** — upstream publishes goreleaser binaries only, no
  container (verified 2026-07-19). Build from a pinned commit via
  `packages/homelab/images/shelfbridge/Dockerfile`, following the redlib
  pattern (renovate `git-refs` pin, bake target, smoke test).
- **Single instance, all sources** — upstream's compose example splits LibGen /
  AA by port; one deployment with `SOURCE_*` flags is simpler and Bindery
  dedupes results.
- **Z-Library enabled anonymously** — no account exists today; the adapter
  returns anonymous-tier results without `ZLIB_EMAIL`/`ZLIB_PASSWORD`. Wiring
  creds later = new 1Password fields + two env vars.
- **API key in 1Password** — item `shelfbridge` (id
  `kdre4uvjpjeyaccfhrxfvs5rqy`) in vault `Homelab (Kubernetes)`, consumed via
  `OnePasswordItem`; required ref (no optional secrets policy).
- **No Tailscale ingress** — consumers are in-namespace only (Prowlarr/Bindery
  API queries, qBittorrent webseeds). `PUBLIC_BASE_URL` is the cluster Service
  DNS name so webseed URLs resolve from inside the qBittorrent pod.

## Phase C pivot: Bindery-direct, not tofu

Planned: add ShelfBridge to Prowlarr via tofu as a generic Torznab indexer.
Verified against the provider schema (`tofu providers schema -json` on
`devopsarr/prowlarr`): there is **no** `prowlarr_indexer_torznab` resource —
only the Cardigann-style `prowlarr_indexer`, whose `fields` attribute is
exactly what broke arr applies before ("Provider produced inconsistent result
after apply: .fields" — main build 5039, documented in
`packages/homelab/src/tofu/arr/resources.tf`). Creating a new indexer with a
sensitive `apiKey` field risks failing every arr apply on main.

Pivot: ShelfBridge is added **directly in Bindery** as a Torznab indexer
(one-time UI/API config, documented in the operator guide). Bindery already
requires manual first-run config (no tofu provider exists), so this adds one
indexer entry to an already-manual step at zero apply risk. This is also
ShelfBridge's own documented Bindery flow (`t=book` with separate
title/author params).

## Work items

### Phase A — image (done)

- `packages/homelab/images/shelfbridge/Dockerfile` — golang:1.26-alpine
  builder → CGO-off static build `./cmd/shelfbridge` → alpine:3.22 runtime,
  `USER 65532`, pin `SHELFBRIDGE_SOURCE_REF` + renovate git-refs manager in
  `renovate.json`
- `docker-bake.hcl` — `shelfbridge` target in the `infra` group
- `.buildkite/scripts/bake-images.sh` — `INFRA_IMAGES` += shelfbridge
- `packages/homelab/scripts/smoke-images.ts` — boots with `API_KEY`, polls
  `/health`, asserts `/torznab/api?t=caps` answers — passes locally

### Phase B — cdk8s (done)

- `resources/torrents/shelfbridge.ts` — Deployment (non-root 65532, RO rootfs,
  drop ALL caps, resource requests), `OnePasswordItem` API key, env
  (`PUBLIC_BASE_URL=http://media-shelfbridge-service:8787`,
  `WEBSEED_MODE=proxy`, sources on), Service :8787, `/health` probes
- `cdk8s-charts/media.ts` — `createShelfbridgeDeployment(chart)`
- `versions.ts` — `shepherdjerred/shelfbridge` seed placeholder (CI
  commit-back fills real tag@digest on first main push)
- 1Password: item created; `onepassword-vault-snapshot.json` refreshed
  (`check:1password` green: 56 items / 133 fields)

### Phase C — wiring (docs-only after pivot)

- Operator guide: Bindery indexers = Prowlarr (Newznab aggregate) **and**
  ShelfBridge (Torznab, `http://media-shelfbridge-service:8787/torznab/api`,
  API key from the `shelfbridge` 1Password item, categories 7020 + 3030)

### Phase D — docs (done)

- Plan mirrored here; `guides/2026-07-19_ebook-stack-bindery-cwa.md` extended
  with the ShelfBridge leg

### Phase E — verify

- [x] `docker buildx bake shelfbridge` + smoke pass locally
- [x] cdk8s typecheck + synth (`media-shelfbridge-service` name confirmed)
- [x] `check:1password` green
- `bun run verify -- --affected`
- Post-merge E2E: Bindery search for a Chinese title (e.g. 原子习惯) →
  grab → qBittorrent pulls via webseed → CWA ingest → library

## Known risk

**Gluetun outbound firewall**: qBittorrent runs in gluetun's netns, which sets
only `FIREWALL_VPN_INPUT_PORTS`. Webseed downloads to
`media-shelfbridge-service` (cluster IP) may be dropped. If E2E stalls at the
download step, add `FIREWALL_OUTBOUND_SUBNETS=<pod/service CIDR>` to the
gluetun env in `resources/torrents/qbittorrent.ts`.

## Follow-ups (not in this PR)

- Z-Library account + `ZLIB_EMAIL`/`ZLIB_PASSWORD` fields for higher limits
- Reconsider tofu management if devopsarr/prowlarr ever ships a generic
  Torznab indexer resource

## Historical follow-up state

- Complete and verify the work described in `ShelfBridge Torznab leg for the ebook stack`.
