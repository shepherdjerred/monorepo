---
id: batched-renovate-update-2026-07-26
type: plan
status: in-progress
board: false
---

# One-PR batched Renovate update (2026-07-26)

## Context

The Renovate Dependency Dashboard lists ~90 pending updates, held back by
`minimumReleaseAge: 30 days` + a Sunday schedule (`renovate.json`). Rather than
let them trickle out as dozens of individual auto-merge PRs, we land **one PR**
that applies every safe update now. Scope decisions (confirmed with the user):

- **Include**: all Docker image/tag/digest bumps, **all** Helm charts, Terraform
  providers (aws/cloudflare), mise toolchain (go/opentofu/rust), all safe
  minor/patch npm bumps, the React Native cluster (verified locally on this Mac),
  **Renovate-coverage fixes** for audited blind spots (§8), and **majors that need
  few code changes** — attempted opportunistically, kept only if the delta is
  small (§9).
- **Sync, not bump**: the Talos/Kubernetes _deployed-reality_ pins get aligned to
  what the cluster is actually running (§ Deployed-reality).
- **Defer**: the Renovate-pinned velero-plugin/protobufjs, and any §9 major that
  fails its small-delta test.
- **N/A**: several dashboard items don't exist in this repo or are already at
  target (see table).
- **Machine load**: expensive repo-wide checks are batched to a single quiet-machine
  pass (see Verification).

Everything is verified via `bun run verify -- --affected` + targeted builds
before the PR is promoted from draft.

## Discrepancies found during recon (dashboard ≠ repo)

| Dashboard item               | Reality                                          | Action       |
| ---------------------------- | ------------------------------------------------ | ------------ |
| nginx digest                 | No nginx base image pinned anywhere              | **N/A skip** |
| ubuntu:26.04 / ubuntu v26    | Only `ubuntu:noble` (24.04) in redlib Dockerfile | **N/A skip** |
| docker v29                   | Docker CLI pinned at `28-cli`; v29 is major      | **Defer**    |
| react-router-dom v7.18.0     | Repo uses `react-router` v8, no `-dom`           | **N/A skip** |
| @lancedb/lancedb             | Not present anywhere                             | **N/A skip** |
| helm release kyverno         | Kyverno removed from repo                        | **N/A skip** |
| kueue docker tag             | Kueue removed from repo                          | **N/A skip** |
| react-native-worklets ^0.9.0 | Already `^0.10.0` (higher)                       | **N/A skip** |
| axios v1.18.0 (root)         | Root already `1.18.0`                            | already done |
| sharp ^0.35.0                | Already `^0.35.0`                                | already done |

## Scope: what we bump

### 1. Docker images in `versions.ts` (`packages/homelab/src/cdk8s/src/versions.ts`)

Format is `"tag@sha256:<digest>"` — every bump needs the **full new digest**
(resolve with `crane digest <img>:<tag>` or `docker manifest inspect <img>:<tag>`).

| Key                                                       | Line   | New tag                                    |
| --------------------------------------------------------- | ------ | ------------------------------------------ |
| `cloudflare/cloudflared`                                  | 99     | `2026.6.1`                                 |
| `temporalio/ui`                                           | 325    | `2.52.1`                                   |
| `bugsink/bugsink`                                         | 299    | `2.4.0`                                    |
| `plexinc/pms-docker`                                      | 45     | `1.43.3.10828-00f62d37d-amd64`             |
| `linuxserver/radarr`                                      | 74     | `6.3.0`                                    |
| `pinchtab/pinchtab`                                       | 193    | `0.15.0`                                   |
| `recyclarr`                                               | 237    | `8.7.0`                                    |
| `agent-stack-k8s`                                         | 195    | `0.46.0`                                   |
| `library/debian`                                          | 278    | `bookworm-slim` + new digest `7b140f374b…` |
| `linuxserver/{bazarr,prowlarr,sonarr,syncthing,tautulli}` | (grep) | **digest-only** refresh (tags unchanged)   |

### 2. Helm charts in `versions.ts` — ALL (user: "all charts, all updates")

Bare-semver bumps: `seaweedfs`→4.34.0, `alloy`→1.10.1, `argo-cd`→10.1.4,
`pyroscope`→2.1.1, `redis`→27.0.15, `tailscale-operator`→1.98.9,
`kube-prometheus-stack`→87.17.0, `loki`→7.1.0, `mariadb`→26.2.0,
`node-feature-discovery`→0.19.0. **After bumping, regenerate helm types** (see
Verification) or the `pr-dryrun` drift check fails.

### 3. Docker base images / tags in Dockerfiles & compose

| Image                      | File(s)                                                                                               | New                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| `docker/buildx-bin`        | `.buildkite/ci-image/Dockerfile:16`                                                                   | `0.35.0` + digest       |
| `docker/dockerfile:1-labs` | 10 Dockerfiles (line 1 each)                                                                          | digest refresh (→v1.25) |
| `emscripten/emsdk`         | `discord-plays-mario-kart/Dockerfile:28`                                                              | `2.0.34` + digest       |
| `node:24-slim`             | `homelab/images/{mcp-gateway,obsidian-headless}/Dockerfile:13`                                        | digest `6f7b03f…`       |
| `rust:slim-bookworm`       | `homelab/images/redlib/Dockerfile:26`                                                                 | digest refresh          |
| `grafana/tempo`            | `llm-observability/test/e2e/compose.yaml:4`, `scripts/observability/local-stack/docker-compose.yml:3` | `2.10.7` + digest       |
| `grafana/grafana`          | `scripts/observability/local-stack/docker-compose.yml:20`                                             | `13.1.0` + digest       |

_(debian in `ci-image/Dockerfile:7` is already at the target digest — no change.)_

### 4. Terraform providers (`packages/homelab/src/tofu/*/providers.tf`)

- `hashicorp/aws` `~> 6.44` → `~> 6.55` (`seaweedfs/providers.tf:7`) — note
  renovate `skipArtifactsUpdate` for the aws lockfile; run `tofu providers lock`
  to refresh `.terraform.lock.hcl` hashes.
- `cloudflare/cloudflare` `~> 5.19` → `~> 5.22` (`cloudflare/providers.tf:7`).

### 5. mise toolchain (`.mise.toml`)

`go` 1.25→**1.26.4**, `opentofu` 1.10→**1.12.3**, `rust` 1.95.0→**1.96.0**.
(Check per-package `mise.toml` files for go/opentofu overrides; check `go.mod`
`go` directives.)

### 6. npm — safe minor/patch (edit declared version, then `bun install`)

**Root `package.json`**: `@anthropic-ai/claude-agent-sdk`→0.3.183,
typescript-eslint set (`eslint-plugin`/`parser`/`utils`/`typescript-eslint`)→8.61.1,
`fast-uri`→3.1.3, `fast-xml-builder`→~1.3.0, `js-cookie`→3.0.8,
`shell-quote`→1.10.0, `tmp`→0.2.7, `knip`→6.17.1, `markdownlint-cli2`→^0.23.0,
`turbo`→2.10.5.

**Grouped bumps across packages** (edit floors to the new target so the lockfile
actually moves, then `bun install`):

| Group                          | Target        | Declaring packages (representative)                                                                                                    |
| ------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| typescript-eslint monorepo     | 8.61.1        | root, sjer.red, eslint-config, tasknotes-_, scout, mario-kart/_, pokemon/\*, homelab (carets `^8.28`–`^8.59.3`)                        |
| @opentelemetry/\*              | ^0.219.0      | birmel, temporal, llm-observability, scout backend, discord-plays-core, mario-kart backend, pokemon backend                            |
| @temporalio/\*                 | 1.18.1        | temporal (+`@temporalio/testing` in homelab/src/cdk8s)                                                                                 |
| @sentry/bun                    | 10.58.0       | birmel (exact 10.53.1), temporal, scout backend, streambot, starlight-karma-bot, tasknotes-server, trmnl-dashboard, discord-plays-core |
| @libsql/client                 | 0.17.4        | birmel, scout backend, mario-kart backend                                                                                              |
| @anthropic-ai/sdk              | 0.105.0       | temporal, monarch, llm-observability                                                                                                   |
| @anthropic-ai/claude-agent-sdk | 0.3.183       | root, birmel, llm-observability                                                                                                        |
| satori                         | ^0.28.0       | scout report, astro-opengraph-images                                                                                                   |
| smol-toml                      | 1.7.0         | mario-kart backend, pokemon backend                                                                                                    |
| eslint-import-resolver-node    | ^0.4.0        | eslint-config                                                                                                                          |
| react (lockstep)               | latest 19.2.x | ~20 packages pin `react` exactly (19.2.3/6/7); `@types/react` `^19.2.14`                                                               |

**versions.ts npm pin**: `@r-huijts/canvas-mcp` 1.0.8→1.3.0 (line 293).

### 7. React Native cluster (`packages/tasks-for-obsidian/package.json`) — INCLUDE

`react-native` 0.85.3→0.86.0; `@react-native/{babel-preset,metro-config,typescript-config}`
0.85.3→0.86.0; `react-native-gesture-handler` 2.31.1→2.32.0;
`react-native-screens` 4.25.2→4.26.2. (`react-native-worklets` already higher — skip.)
Verify by building/running the app locally (see Verification).

### 8. Renovate coverage fixes (audit follow-up — all in this PR)

An audit found real version pins Renovate can't see (no `# renovate:` annotation,
no native manager). Fix all high-value ones here — it's the same Renovate-hygiene
theme:

| #   | Location                                                                              | Fix                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/birmel/Dockerfile:58-59` (`GH_CLI_VERSION`, `CLAUDE_CODE_VERSION`)          | Add `# renovate:` annotations, copying `packages/temporal/Dockerfile:85-88` (`datasource=github-releases depName=cli/cli`; `datasource=npm depName=@anthropic-ai/claude-code`).                                                         |
| 2   | `.buildkite/ci-image/Dockerfile:44` (`CLAUDE_CODE_VERSION`)                           | Add `datasource=npm depName=@anthropic-ai/claude-code` annotation.                                                                                                                                                                      |
| 3   | `.buildkite/ci-image/Dockerfile:30` (`MISE_VERSION="v2026.7.1"`)                      | Add `datasource=github-releases depName=jdx/mise` annotation.                                                                                                                                                                           |
| 4   | `scripts/pyright-check.sh:7` (`PYRIGHT_VERSION`)                                      | Add `datasource=npm depName=pyright` annotation **and** a new `customManagers` regex entry covering `scripts/**/*.sh` + `packages/*/scripts/**/*.sh` (pattern: `# renovate: …\nVAR="value"`), mirroring the Xcode ci_scripts manager.   |
| 5   | `packages/homelab/src/cdk8s/src/resources/monitoring/kubernetes-event-exporter.ts:10` | Move `ghcr.io/resmoio/kubernetes-event-exporter:v1.7` into `versions.ts` with a `// renovate: datasource=docker registryUrl=https://ghcr.io` annotation + resolved digest; read it via `versions["resmoio/kubernetes-event-exporter"]`. |
| 6   | `packages/discord-plays-mario-kart/scripts/build-wasm.sh:16` (`EMSDK_IMAGE=…:2.0.7`)  | Annotate (covered by the new `scripts/**/*.sh` customManager) so it tracks in lockstep with the Dockerfile `FROM`; bump to 2.0.34 to match §3.                                                                                          |

Also (per user): **fix the mise `java` pin** — `.mise.toml` `java = "corretto-25.0.3.9.1"`.
Verify the string is a real installable version (`mise ls-remote java | grep corretto-25`)
and make it Renovate-trackable via a `customManagers` regex entry keyed to
`datasource=github-releases depName=corretto/corretto-25` (Amazon Corretto ships
GitHub release tags like `25.0.3.9.1`). Confirm the current pin matches a live tag.

Parity note (optional, low urgency): `vendor-n64wasm.sh:19` `UPSTREAM_SHA` could get
a `git-refs` customManager like pokeemerald's — deferred (manual re-vendor script).

### Low-value items — document as known gaps, don't churn config

- **Brewfiles** untracked (no homebrew manager) but nothing version-pinned → drift risk only.
- **mise** bare-major pins (`helm="3"`, `argocd="3"`, `awscli="2"`, `gh="2"`, `jq="1"`) — coarse but functional.
- **`scripts/python-dev-requirements.txt`** bare names + PEP-723 `uv run` headers — untrackable by design.
- **`versions.ts`** `tailscale/golink` (rolling `main`) and `relay-server` (private registry) — deliberate exclusions.

## 9. Majors — attempt opportunistically (keep IFF the code delta is small)

Per user: majors are in scope **when they need few code changes**. Method per major:
bump it → run `bunx turbo run typecheck build lint test --filter=<affected pkg>` →
**keep if it's clean or a small localized fix; revert + defer if it needs real
migration.** Blast-radius priors below (verified by grep where noted):

| Major                                                                                                            | Blast radius / verify                                                                                                                                                                                                                           | Prior                                              |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `fast-uri` v4                                                                                                    | **0 direct import sites** (tool/transitive dep) — bump root devDep floor                                                                                                                                                                        | **Easy — take**                                    |
| `tslog` v5                                                                                                       | 1 file (`scout backend/src/logger.ts`) — migrate if API changed                                                                                                                                                                                 | **Easy — take**                                    |
| `grafana/tempo` v3                                                                                               | dev/test compose only (llm-observability, local-stack) — `docker compose config`                                                                                                                                                                | **Easy — take** (no prod blast)                    |
| `@types/node` v26                                                                                                | type-only; `bun run typecheck` catches breakage                                                                                                                                                                                                 | **Easy — take if typecheck clean**                 |
| `docker` CLI v29                                                                                                 | bump `ci-image/Dockerfile:15` FROM + `docker-env.sh:15` `DOCKER_CLI_VERSION` + `validate-pipeline.ts:639` `docker:28-dind` string; run pipeline-validate test                                                                                   | **Easy-medium — take if validate passes**          |
| `jscpd` v5                                                                                                       | wired into `eslint-config/src/rules/jscpd-duplication.ts` (programmatic API) + `.jscpd.json` configs — verify the custom rule still runs                                                                                                        | **Medium — take if rule works**                    |
| `eslint-plugin-unicorn` v67, `eslint-plugin-astro` v3                                                            | new/changed rules may add lint errors — fixable-if-few, else defer                                                                                                                                                                              | **Medium**                                         |
| `@astrojs/mdx` v6, `htmlparser2` v12, `pdfjs-dist` v6                                                            | astro/webring/monarch — build+test the one package                                                                                                                                                                                              | **Medium**                                         |
| `emscripten/emsdk` v6, `babel` v8, `react-native-gesture-handler` v3                                             | wasm rebuild / RN toolchain (pairs with §7 RN 0.86) — verify build                                                                                                                                                                              | **Medium**                                         |
| `ubuntu` v26 (redlib base)                                                                                       | **NOT the easy win it looks like.** Only pin is `redlib/Dockerfile:52` `ubuntu:noble`; the glibc/TLS stack is load-bearing for Reddit OAuth (`docs/guides/2026-06-28_redlib-glibc-self-build.md`). Bump only if redlib auth verifies post-build | **Sensitive — verify or defer**                    |
| `ai` v7 + `@ai-sdk/openai` v4, `typescript` v7, `helm` CLI v4, `node-av` v6, `vite` v8, `tokio-tungstenite` 0.30 | large API/toolchain surface (birmel AI rewrite / whole-repo compiler / homelab helm tooling / native AV / multi-pkg build / Rust-Tauri)                                                                                                         | **Hard — default defer** unless it turns out clean |

## Deployed-reality pins — SYNC to the live cluster (per user)

Not a Renovate bump: set these to whatever `torvalds` is **actually running**, then
reconcile the README upgrade snippet (`version-management` skill rule).

- Query live: `talosctl version` and `kubectl version` / `kubectl get nodes -o wide`
  (load `talos-helper` / `kubectl-helper`).
- Set `versions.ts:241` `siderolabs/talos` and `versions.ts:234` `kubernetes/kubernetes`
  to the running versions; update `packages/homelab/README.md` `VERSION=` lines to match.
- If pins already equal reality, make no change and note it. **Do not `talosctl upgrade`** —
  this only aligns the record to the cluster, it does not upgrade the cluster.

## Still deferred

- **Renovate-pinned** (deliberate, do not touch): `velero-plugin-for-aws` (<1.14.1),
  `protobufjs` (<8).
- Any major from §9 that fails its small-delta test.

## Execution order

1. **Docs + worktree**: create this plan's mirror at
   `packages/docs/plans/2026-07-26_batched-renovate-update.md`, then a worktree
   `git worktree add .claude/worktrees/renovate-batch -b deps/batched-renovate origin/main`;
   `mise install && bun install --frozen-lockfile && bunx turbo run generate && bunx lefthook install`.
2. **Resolve digests**: script a loop over the docker bumps to fetch full digests
   (`crane digest`), collect into a lookup used for the edits.
3. **Apply edits** grouped: (a) versions.ts docker+helm+canvas-mcp+event-exporter,
   (b) Dockerfiles & compose, (c) terraform, (d) mise (bumps + java fix),
   (e) npm package.json (root + grouped + RN), (f) Renovate coverage fixes §8
   (annotations + `renovate.json` customManagers for scripts/\*.sh and corretto java),
   (g) deployed-reality sync (query cluster → talos/k8s pins + README).
4. **Regen**: `bun install`; `cd packages/homelab/src/cdk8s && bun --no-install run generate-helm-types`; `tofu providers lock` for aws/cloudflare.
5. **Majors pass** (§9): apply each candidate, verify the affected package only,
   keep-or-revert per the small-delta rule.
6. **Verify incrementally, scoped** (see machine-load note); fix-forward per
   migration guides.
7. **Draft PR** via git-spice (`git-spice branch`/`stack submit --draft`), promote
   to ready after the final quiet-machine verification pass is green. Attach a
   Grafana/local-stack screenshot only if a visible surface changed (most is non-visual).

## Verification

> **Machine-load note (per user): the machine is busy right now — defer expensive
> repo-wide checks until it's quiet.** During active editing, verify each change
> **scoped to its package**: `bunx turbo run typecheck build lint test --filter=<pkg>`
> (replays from turbo cache in ms when unchanged). Do **not** run the full
> `bun run verify`, repo-wide lints (knip, markdownlint, gitleaks), the live-fetch
> `argocd-helm-render.test.ts`, or `renovate-config-validator` concurrently with
> other load. Batch all of those into a **single final pass when the machine is idle**.

- **Final (quiet-machine) pass**: `bun run verify -- --affected` — build + typecheck
  - test + lint + all repo checks (covers cdk8s synth, `helm-template.test.ts`,
    `argocd-helm-render.test.ts` live-fetch of bumped charts, knip, markdownlint,
    prettier, todos, suppressions).
- **Helm drift**: `cd packages/homelab/src/cdk8s && bun --no-install run generate-helm-types --check` must exit 0.
- **Terraform**: for aws & cloudflare stacks `tofu -chdir=<stack> init -backend=false && tofu validate`.
- **Docker digests**: confirm every new `img:tag@digest` resolves (`crane manifest`/`docker manifest inspect`).
- **RN app**: from `packages/tasks-for-obsidian`, install pods + build the iOS app
  (and/or run it) to confirm the 0.86 bump + Metro/native bits are clean.
- **Grafana compose** (optional): `docker compose -f scripts/observability/local-stack/docker-compose.yml config` to sanity-check the new tags parse.
- **Renovate config**: after editing `renovate.json`, validate with
  `npx --yes --package renovate -- renovate-config-validator renovate.json`
  (segfaults under bun — run via node). Confirm the new customManagers' regex
  matches by eye against the annotated `scripts/*.sh` / `.mise.toml` lines.
- **Coverage-fix targets resolve**: `pyright@1.1.411`, `jdx/mise` tag, `cli/cli`
  tag, `@anthropic-ai/claude-code` on npm, and `corretto/corretto-25` tag
  `25.0.3.9.1` all exist (so the new annotations point at real datasources).

## Risks / caveats

- Docker digest resolution needs registry egress + `crane`/`docker` available.
- `argocd-helm-render.test.ts` fetches bumped charts live; a 504 is a _non-fatal
  skip_, but a real 404/schema error on a bumped chart is a hard failure to fix.
- Helm chart bumps deploy to the live homelab via ArgoCD **after merge** — chart
  schema changes surface in the drift/render tests, but runtime behavior is
  post-merge. `kube-prometheus-stack` (minor) and `argo-cd`/`tailscale-operator`
  (control-plane) are the ones to watch on sync.
- The npm floor edits touch many files; keep them mechanical and let `bun install`
  reconcile one root `bun.lock`.
- `hashicorp/aws` lockfile isn't auto-updated by Renovate (`skipArtifactsUpdate`);
  `tofu providers lock` requires the provider be fetchable.
- **ubuntu/redlib**: the ubuntu major touches redlib's glibc base, which is the
  fix for Reddit's OAuth TLS-fingerprint block — treat as sensitive, verify redlib
  auth before keeping (don't lump it with the "easy" majors).
- **Majors churn**: attempting many majors can balloon the diff. The keep-if-small
  rule bounds it; log every major that was deferred (and why) so it's not silently dropped.
- **Deployed-reality sync** needs live `talosctl`/`kubectl` access to the cluster;
  if unreachable, leave the pins untouched and note it rather than guessing.

## Session Log — 2026-07-26

### Done

- Landed one PR (#1706, branch `deps/batched-renovate`, draft) — 67 files, full `verify --affected` green in pre-commit.
- versions.ts: 14 docker image tag+digest bumps (crane-resolved), 10 helm charts (+regenerated types), @r-huijts/canvas-mcp 1.3.0, hass-dreo v1.10.2 (+DREO sha, integrity test 9-pass), kubernetes-event-exporter centralized.
- Dockerfiles/compose: buildx-bin 0.35.0, emsdk 2.0.34, node/rust digests, grafana tempo→3.0.2 + grafana 13.1.0.
- terraform: aws 6.56.0, cloudflare 5.22.0 (+regenerated locks, `tofu validate` clean). mise: go 1.26.4, opentofu 1.12.3, rust 1.96.0, corretto java 25.0.4.7.1.
- npm: typescript-eslint 8.61.1, otel 0.219, temporalio 1.18.1, @sentry/bun 10.68.0, libsql, anthropic SDKs, satori, smol-toml, resolver-node, react/react-dom 19.2.8, knip/turbo/markdownlint, fast-uri/fast-xml-builder/js-cookie/shell-quote/tmp (overrides).
- RN 0.86 cluster in tasks-for-obsidian + regenerated `ios/Podfile.lock` (pod update; portable) — Xcode Cloud Archive would have broken on the stale 0.85.3 lock.
- Majors kept: @types/node 26, jscpd 5, pdfjs-dist 6, htmlparser2 12, @astrojs/mdx 6 (astro→6.4.8), eslint-plugin-astro 3, grafana/tempo 3.
- Renovate coverage: annotations (birmel/ci-image ARGs, MISE_VERSION), new customManagers (scripts/\*.sh, corretto java, n64wasm source SHA), BUILDX_VERSION alignment.
- Deployed-reality talos/k8s pins verified already aligned with the live cluster (no change).

### Remaining

- PR is **draft**; promote to ready-for-review after human glance (large diff). Full local iOS xcodebuild not run (pod update succeeded → native deps resolve; Archive is Xcode Cloud's gate).
- Post-merge: helm chart bumps deploy via ArgoCD — watch kube-prometheus-stack / argo-cd / tailscale-operator sync.

### Caveats

- Deferred (heavy/architectural, each with reasons in the Defer sections): tslog v5 (v5.1.0 settings restructure + unreliable published types — attempted & reverted twice), eslint-plugin-unicorn v67 (731+ new errors across 39 packages), docker CLI v29, fast-uri v4 (ajv ^3.0.1 runtime risk), babel v8, react-native-gesture-handler v3, tokio-tungstenite 0.30, ubuntu v26, vite v8, typescript v7, helm CLI v4, node-av v6, ai v7/@ai-sdk v4.
- bazarr/syncthing docker digests differ from the stale dashboard snapshot — pinned the live current digests (correct).
- The "not restacked" git-spice warning on submit is benign (local main stale in another worktree; branch is correctly 1 commit off origin/main).
- `ios/.xcode.env.local` created locally (gitignored, not committed).
