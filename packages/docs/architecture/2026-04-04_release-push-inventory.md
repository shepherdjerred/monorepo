# Release / Push / Deploy Inventory

Complete inventory of everything this monorepo publishes externally. Central source of truth: `scripts/ci/src/catalog.ts`.

All targets are orchestrated via **Buildkite CI** using **Dagger** as the build engine.

## Summary

| Category             | Count | Destination                              | Auth         |
| -------------------- | ----- | ---------------------------------------- | ------------ |
| Docker / OCI images  | 11    | `ghcr.io/shepherdjerred/*`               | GH_TOKEN     |
| Helm charts          | 27    | ChartMuseum (`chartmuseum.sjer.red`)     | HTTP Basic   |
| npm packages         | 3     | npm registry                             | NPM_TOKEN    |
| Static sites (S3)    | 8     | SeaweedFS + Cloudflare R2                | AWS creds    |
| GitHub releases      | 2     | GitHub API                               | GH_TOKEN     |
| Git push (automated) | 2     | origin (version commits, release-please) | GH_TOKEN     |
| OpenTofu apply       | 3     | Cloudflare, GitHub, SeaweedFS            | Multiple     |
| ArgoCD sync          | 1     | K8s cluster via `argocd.sjer.red`        | ArgoCD token |

## Docker / OCI Images → GHCR

Tags: `2.0.0-{BUILD_NUMBER}` + `latest`
Code: `.dagger/src/image.ts`, `scripts/ci/src/steps/images.ts`, `scripts/ci/src/catalog.ts`

### Application images (6)

| Image                       | Package               | Registry Path                                        |
| --------------------------- | --------------------- | ---------------------------------------------------- |
| birmel                      | birmel                | `ghcr.io/shepherdjerred/birmel`                      |
| tasknotes-server            | tasknotes-server      | `ghcr.io/shepherdjerred/tasknotes-server`            |
| scout-for-lol               | scout-for-lol         | `ghcr.io/shepherdjerred/scout-for-lol`               |
| discord-plays-pokemon       | discord-plays-pokemon | `ghcr.io/shepherdjerred/discord-plays-pokemon`       |
| starlight-karma-bot         | starlight-karma-bot   | `ghcr.io/shepherdjerred/starlight-karma-bot`         |
| better-skill-capped-fetcher | better-skill-capped   | `ghcr.io/shepherdjerred/better-skill-capped-fetcher` |

### Infrastructure images (4)

| Image              | Registry Path                               |
| ------------------ | ------------------------------------------- |
| homelab            | `ghcr.io/shepherdjerred/homelab`            |
| dependency-summary | `ghcr.io/shepherdjerred/dependency-summary` |
| dns-audit          | `ghcr.io/shepherdjerred/dns-audit`          |
| caddy-s3proxy      | `ghcr.io/shepherdjerred/caddy-s3proxy`      |

### CI base image (1, manually pushed)

`ghcr.io/shepherdjerred/ci-base:{VERSION}` — built from `.buildkite/ci-image/`

## Helm Charts → ChartMuseum

27 charts from `packages/homelab/src/cdk8s/helm/`. Version: `2.0.0-{BUILD_NUMBER}`.

Code: `.dagger/src/release.ts`, `scripts/ci/src/steps/helm.ts`

ddns, apps, scout-beta, scout-prod, starlight-karma-bot-beta, starlight-karma-bot-prod, redlib, better-skill-capped-fetcher, plausible, birmel, cloudflare-tunnel, media, home, postal, syncthing, golink, freshrss, pokemon, gickup, grafana-db, mcp-gateway, s3-static-sites, kyverno-policies, bugsink, dns-audit, tasknotes

## npm Packages → npm Registry

Dev: `0.0.0-dev.{BUILD_NUMBER}` (`--tag dev`). Prod: from `package.json` (`--tag latest`).

Code: `.dagger/src/release.ts`, `scripts/ci/src/steps/npm.ts`

| Package                      | Directory                         |
| ---------------------------- | --------------------------------- |
| `astro-opengraph-images`     | `packages/astro-opengraph-images` |
| `webring`                    | `packages/webring`                |
| `@shepherdjerred/helm-types` | `packages/homelab/src/helm-types` |

## Static Sites → S3 (SeaweedFS)

Method: `aws s3 sync --delete`. Code: `.dagger/src/release.ts`, `scripts/ci/src/steps/sites.ts`

| Site                       | Bucket              | URL                               |
| -------------------------- | ------------------- | --------------------------------- |
| sjer.red                   | sjer-red            | https://sjer.red                  |
| clauderon docs             | clauderon           | https://clauderon.com             |
| resume                     | resume              | https://resume.sjer.red           |
| webring                    | webring             | https://webring.sjer.red          |
| cooklang-rich-preview      | cook                | https://cook.sjer.red             |
| scout-for-lol frontend     | scout-frontend      | https://scout-for-lol.com         |
| better-skill-capped        | better-skill-capped | https://better-skill-capped.com   |
| discord-plays-pokemon docs | dpp-docs            | https://discord-plays-pokemon.com |

## GitHub Releases & Artifacts

**Cooklang for Obsidian plugin** — pushes `main.js`, `manifest.json`, `styles.css` to `shepherdjerred/cooklang-for-obsidian` repo and creates GitHub releases. Code: `.dagger/src/release.ts` (cooklangPushHelper, cooklangCreateReleaseHelper).

**Clauderon (Rust CLI)** — multi-arch binaries (x86_64 + arm64). Dev pre-releases `0.0.0-dev.{BUILD_NUMBER}` on `shepherdjerred/monorepo`. Prod releases via release-please. Code: `.dagger/src/release.ts` (clauderonUploadHelper, clauderonCollectBinariesHelper).

## Automated Git Pushes

**Version commit-back** — updates `packages/homelab/src/cdk8s/src/versions.ts` with image digests, commits and pushes. Code: `.dagger/src/release.ts` (versionCommitBackHelper), `scripts/ci/src/steps/version.ts`.

**Release-please** — creates/updates version bump PRs, auto-generates GitHub releases with changelogs. Config: `release-please-config.json`, `.release-please-manifest.json`. Code: `.dagger/src/release.ts` (releasePleaseHelper).

## OpenTofu Infrastructure Apply

Code: `packages/homelab/src/tofu/`, `scripts/ci/src/steps/tofu.ts`

| Stack      | Target       | Resources                                                                                                                                                                                                                     |
| ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cloudflare | Cloudflare   | 9 DNS zones (sjer.red, jerredshepherd.com, shepherdjerred.com, clauderon.com, scout-for-lol.com, discord-plays-pokemon.com, better-skill-capped.com, glitter-boys.com, ts-mc.net, jerred.is), records, DNSSEC, email security |
| github     | GitHub       | Repo config, branch protection, rulesets                                                                                                                                                                                      |
| seaweedfs  | SeaweedFS S3 | 14 buckets (static sites + app data + caches)                                                                                                                                                                                 |

## ArgoCD Kubernetes Sync

Syncs the `apps` ArgoCD application (managing ~65 sub-applications), then waits for health. Endpoint: `argocd.sjer.red`. Code: `.dagger/src/release.ts`, `scripts/ci/src/steps/argocd.ts`.

## Pipeline Flow

```
Git push to main
  → Buildkite pipeline generated (scripts/ci/src/main.ts)
  → Change detection (affected packages)
  → Parallel:
      ├─ Build + push Docker images → GHCR
      ├─ Build + deploy static sites → S3
      ├─ Publish npm packages → npm
      ├─ CDK8s synth + Helm package → ChartMuseum
      ├─ Clauderon binaries → GitHub Releases
      └─ Cooklang plugin → GitHub repo + releases
  → Version commit-back (digests → versions.ts)
  → Tofu apply (Cloudflare, GitHub, SeaweedFS)
  → ArgoCD sync + health wait
  → Release-please (version bump PRs)
```
