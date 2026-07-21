---
id: reference-completed-2026-06-07-pr-asset-public
type: reference
status: complete
board: false
---

# Plan: `public.sjer.red` PR-asset image host

## Context

`gh` has no API to upload images into a PR/issue body (drag-drop uses a private,
session-authenticated endpoint PATs can't reach), so AGENTS.md's "include
screenshots in PRs" rule had no scriptable path. We already run a public,
S3-compatible SeaweedFS (`https://seaweedfs.sjer.red`) and a Caddy `s3proxy`
static-site pattern that maps a bucket to a public domain. This adds a dedicated
**`public.sjer.red`** site backed by a `public-sjer-red` bucket, with PR
screenshots under the `pr/assets/<number>/` prefix, plus a `toolkit pr asset`
subcommand to upload them and print ready-to-embed URLs.

Decisions: domain `public.sjer.red`; **365-day TTL** on the `pr/assets/` prefix;
upload helper is a `toolkit` subcommand (SigV4, no AWS SDK).

## URL shape

- Upload (S3 API, creds): `PUT https://seaweedfs.sjer.red/public-sjer-red/pr/assets/<n>/<file>`
- Public (Caddy + Cloudflare): `https://public.sjer.red/pr/assets/<n>/<file>`

Bucket reads are served by Caddy with the proxy's own creds, so the bucket needs
no public ACL change.

## Changes

| Area        | File                                                                          | Change                                                                                                    |
| ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Bucket      | `packages/homelab/src/tofu/seaweedfs/buckets.tf`                              | `aws_s3_bucket "public_sjer_red"`; 365d lifecycle scoped to `pr/assets/`; seed provisioner for root pages |
| Seed pages  | `packages/homelab/src/tofu/seaweedfs/public/{index,404}.html`                 | Minimal landing/404 so `/` returns 200 (keeps root probe green)                                           |
| DNS         | `packages/homelab/src/tofu/cloudflare/sjer-red.tf`                            | `cloudflare_dns_record "sjer_red_cname_public"` → cfargotunnel                                            |
| Static site | `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`           | Append `{ hostname: "public.sjer.red", bucket: "public-sjer-red" }`                                       |
| S3 lib      | `packages/toolkit/src/lib/s3/{client,assets}.ts` (+ `test/s3/assets.test.ts`) | SigV4 `putObject` (ported from `packages/temporal/src/shared/s3.ts`); key/url/content-type helpers        |
| Command     | `packages/toolkit/src/commands/pr/asset.ts`, `handlers/pr.ts`, `index.ts`     | `toolkit pr asset <PR> <files...> [--markdown]`                                                           |
| Docs        | root `AGENTS.md`, `packages/toolkit/AGENTS.md`                                | Document the workflow + creds                                                                             |

## Key reuse

- Static site abstraction `S3StaticSites` / `StaticSiteConfig` in `s3-static-site.ts`; the per-site implicit root `/` http_2xx probe is why we seed `index.html`.
- Lifecycle/seed `terraform_data` mirror the `llm_archive` block (tailnet endpoint `https://seaweedfs-s3.tailnet-1a49.ts.net`).
- Upload signing ported from `packages/temporal/src/shared/s3.ts` (path-style, region us-east-1).

## Verification

- `cd packages/homelab && bun run typecheck`; `bun scripts/check-tunnel-dns-coverage.ts`
- `cd packages/toolkit && bun run typecheck && bun run test:unit`
- Operator: `tofu -chdir=seaweedfs apply` (bucket+lifecycle+seed), `tofu -chdir=cloudflare apply` (DNS), commit cdk8s → ArgoCD syncs Caddy
- E2E: `curl -I https://public.sjer.red/` → 200; `toolkit pr asset 9999 ./test.png --markdown`; `curl -I` the URL → 200 image/png; paste into a throwaway PR comment and confirm GitHub renders it

## Session Log — 2026-06-07

### Done

- Code committed on branch `claude/practical-elgamal-5f7eef` (commit `b5d8dfef0`).
- homelab: `public-sjer-red` bucket + 365d `pr/assets/` lifecycle + root-seed provisioner ([buckets.tf](../../homelab/src/tofu/seaweedfs/buckets.tf)); seed pages [public/index.html](../../homelab/src/tofu/seaweedfs/public/index.html), [public/404.html](../../homelab/src/tofu/seaweedfs/public/404.html); DNS [sjer-red.tf](../../homelab/src/tofu/cloudflare/sjer-red.tf); static-site entry [sites.ts](../../homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts).
- toolkit: SigV4 S3 lib [client.ts](../../toolkit/src/lib/s3/client.ts) + helpers [assets.ts](../../toolkit/src/lib/s3/assets.ts) + tests; `pr asset` command [asset.ts](../../toolkit/src/commands/pr/asset.ts), routed in [pr.ts](../../toolkit/src/handlers/pr.ts), usage in [index.ts](../../toolkit/src/index.ts).
- Docs: root + toolkit AGENTS.md.
- Verified: toolkit typecheck + 16 unit tests; homelab typecheck; static-site tests (31 pass); tunnel-dns-coverage (31 bindings); eslint (toolkit) + tofu fmt clean; full pre-commit tier-1/tier-2 green.

### Remaining

- **Infra apply happens in CI on merge to main** — no manual step. Buildkite's release build runs `homelabTofuGroup()` → `tofu-apply` for the `seaweedfs` (bucket + lifecycle + seed) and `cloudflare` (DNS) stacks, then a unified ArgoCD sync rolls out the Caddy `public.sjer.red` vhost. PRs only run `tofu plan` for review. (`op run -- tofu apply` is the operator fallback, not the normal path.)
- **True E2E** (after the merge build applies): a real `toolkit pr asset` upload + `curl` + GitHub render check. Can't run locally because the bucket doesn't exist until apply and creds need `op`.
- Push branch / open PR (not done — awaiting user).

### Caveats

- Image durability is coupled to the homelab + the 365d TTL on `pr/assets/`.
- `packages/sjer.red/bun.lock` was modified by `scripts/setup.ts` during this session; intentionally left unstaged (unrelated churn).
