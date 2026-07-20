# ShelfBridge Torznab leg for the ebook stack

## Status

In Progress — stacked PR on [#1581](https://github.com/shepherdjerred/monorepo/pull/1581)
(`feature/ebook-stack-shelfbridge` → base `feature/ebook-stack-bindery-cwa`).

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
- [ ] `bun run verify -- --affected`
- [ ] Post-merge E2E: Bindery search for a Chinese title (e.g. 原子习惯) →
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

## Session Log — 2026-07-19

### Done

- Stacked PR [#1587](https://github.com/shepherdjerred/monorepo/pull/1587)
  (base `feature/ebook-stack-bindery-cwa`), commit `01edd279f`
- Image: `packages/homelab/images/shelfbridge/Dockerfile` + bake target +
  `INFRA_IMAGES` + renovate git-refs pin — builds and passes smoke locally
- cdk8s: `resources/torrents/shelfbridge.ts`, `media.ts` wiring, versions
  seed pin; 1Password `shelfbridge` item created (id
  `kdre4uvjpjeyaccfhrxfvs5rqy`) and vault snapshot refreshed
- Verified: `bun run verify -- --affected` 30/30, cdk8s synth (service name
  `media-shelfbridge-service` confirmed), `check:1password` green
- Phase C pivot executed (Bindery-direct Torznab registration, no tofu
  change) after verifying devopsarr/prowlarr has no generic Torznab resource

### Remaining

- Merge #1581, then #1587; first main build bakes/pushes the image and CI
  commit-back fills the real `versions.ts` tag@digest
- **Post-deploy checklist (full steps):**
  [`logs/2026-07-19_shelfbridge-ebook-stack.md`](../logs/2026-07-19_shelfbridge-ebook-stack.md)
  — Bindery indexer registration, Chinese E2E (原子习惯), gluetun fallback

### Caveats

- `versions.ts` shelfbridge pin is a placeholder digest — ArgoCD cannot pull
  the image until the first main build pushes it (same pattern as redlib's
  seed; expected)
- Z-Library runs anonymously; low rate limits until creds are added
- Webseed downloads traverse gluetun's netns — if they stall at 0%, add
  `FIREWALL_OUTBOUND_SUBNETS=<pod/service CIDR>` to the gluetun env in
  `resources/torrents/qbittorrent.ts`
- Anna's Archive / LibGen mirrors churn; `ANNAS_MIRRORS`/`LIBGEN_MIRRORS`
  env may need updates as domains move
