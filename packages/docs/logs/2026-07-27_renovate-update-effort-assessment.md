---
id: renovate-update-effort-assessment-2026-07-27
type: log
status: complete
board: false
---

# Renovate Update Effort Assessment

## Scope

Assess the updates currently listed in Renovate Dependency Dashboard issue #481,
grounded in their actual usage in the repository. Classify likely implementation
effort, verification needs, operational risk, and useful batching.

## Estimate Scale

These estimates include the implementation work, relevant repository verification,
and a proportionate runtime or deployment smoke test:

| Estimate | Typical effort                                         |
| -------- | ------------------------------------------------------ |
| XS       | Less than 1 hour                                       |
| S        | 1–3 hours                                              |
| M        | Half to one day                                        |
| L        | 1–3 days                                               |
| XL       | More than 3 days or a dedicated migration project      |
| Blocked  | Do not start until the named prerequisite is satisfied |

The estimates are not additive. Rows marked for the same batch share setup,
lockfile, CI, and runtime-verification work.

## Executive Assessment

- The dashboard snapshot contains **79 updates**: 9 awaiting schedule, 21
  rate-limited, 46 awaiting status checks, and 3 already-open PRs.
- Most patch updates are XS/S. The costly tail is concentrated in compilers and
  bundlers, native/mobile dependencies, media processing, storage/observability
  infrastructure, and production image promotions.
- The two AI SDK majors are blocked by VoltAgent's current AI SDK 6 peer range.
  TypeScript 7 is also blocked as a direct workspace replacement because the
  current typescript-eslint line supports TypeScript below 6.1.
- Talos, Kubernetes, first-party `/prod` images, and several Helm/Docker pins
  represent deployed state. Their effort is dominated by rollout and validation,
  not editing `versions.ts`.

## Awaiting Schedule

| Update                                       | Effort | Repository-specific reason and minimum verification                                                                                                |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pin `emscripten/emsdk` to digest `3a5cec5`   | XS     | Digest-pin normalization on the existing Mario Kart WASM builder image. Confirm the generated diff and rebuild that image.                         |
| `bindery-source` digest `b5a2d3e`            | S      | Rebuild the custom Bindery image and smoke its patched Google Books ingestion path.                                                                |
| ClickHouse `26.5-alpine` digest `446c9d8`    | S      | Same tag, new production image content. Render manifests, roll ClickHouse, and verify health plus a representative query.                          |
| Distroless static Debian 12 digest `f5b485e` | S      | Rebuild the Bindery runtime image and exercise startup plus one conversion.                                                                        |
| `nginx` digest `5a88c9c`                     | XS     | No active repository pin exists for this dashboard target, so there is no source update to apply.                                                  |
| Cloudflare DDNS `latest` digest `e78ef9d`    | S      | Mutable production image pin. Roll the service and verify DNS records continue updating.                                                           |
| `@anthropic-ai/claude-agent-sdk` `0.3.195`   | S      | Pre-1.0 patch used by Birmel, Sentinel, and LLM-observability paths. Run their focused typechecks/tests and one agent invocation.                  |
| `@types/react` `19.2.17`                     | S      | Broad type-only update across web and React Native workspaces. Run affected typechecks; batch the Tasks app copy with its React Native patch wave. |
| `axios` `1.18.1`                             | XS     | Narrow direct use in the extension manifest loader. Run that package's tests/typecheck.                                                            |

## Rate-Limited

| Update                         | Effort  | Repository-specific reason and minimum verification                                                                                                                                                                                                            |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minecraft server `2026.7.2`    | M       | Three live servers share the pin. Review upstream changes, take/confirm backups, start each server, and verify worlds plus plugins.                                                                                                                            |
| Alpine `3.24`                  | M       | Base-image bump for the custom Bindery and Shelfbridge images. Rebuild both and smoke native/system-package behavior.                                                                                                                                          |
| Knip `6.22.0`                  | S       | Repo-wide quality gate. Run the full Knip check and resolve any newly detected dependency/export findings.                                                                                                                                                     |
| SeaweedFS Helm `4.36.0`        | L       | Stateful storage chart. Regenerate Helm types, render/diff, confirm backups, then validate filer, volume, S3, and existing data after rollout.                                                                                                                 |
| BuildKit `0.31.1`              | L       | Persistent remote CI builder, not an isolated CLI. Validate daemon configuration, cache/GC compatibility, then run representative Buildkite image workloads.                                                                                                   |
| Rust `1.96.0`                  | S       | Align the remaining desktop toolchain pin with the already-pinned repo toolchain; run format, Clippy, tests, and a desktop build.                                                                                                                              |
| typescript-eslint `8.62.0`     | M       | Shared lint stack with repo-wide reach. Update the grouped packages and run the complete lint/suppression surface.                                                                                                                                             |
| `@anthropic-ai/sdk` `0.106.0`  | S       | Pre-1.0 patch used in Temporal, Monarch, LLM observability, and experiments. Run focused API/tests and affected typechecks.                                                                                                                                    |
| `release-please` `17.10.0`     | S       | Main-only release tooling. Run release-tool tests and a no-publish release dry run against representative metadata.                                                                                                                                            |
| Babel 8 monorepo               | L       | Babel 8 is ESM-only and raises the Node floor; the Tasks app still has a CommonJS Babel config plus Metro/worklets plugins. Migrate configuration, reinstall Pods, build the release bundle, and exercise iOS. Keep separate from the React Native patch wave. |
| `fast-uri` 4                   | S       | Major version, but no direct application imports found; it is largely tooling/example exposure. Update independently and build all affected examples.                                                                                                          |
| Helm CLI 4                     | L       | Repo-wide deployment and chart-generation tool. Validate scripts and CI against Helm 4's renamed/changed flags and server-side-apply behavior, then render every chart family.                                                                                 |
| `js-yaml` 5                    | M       | Parser major at a configuration boundary. Locate all indirect consumers through the lockfile, validate parsed fixtures, and run the owning tools.                                                                                                              |
| Vite 8                         | M       | Two remaining Vite 7 sites move to Rolldown/Oxc. Build, test, and browser-smoke `sjer.red` and `stocks-sjer-red`, especially plugin and asset behavior.                                                                                                        |
| Emscripten SDK 6               | XL      | Mario Kart jumps from Emscripten 2 to 6. Treat as a standalone WASM toolchain migration with compile fixes, deterministic artifact comparison, and emulator/runtime play testing.                                                                              |
| Astro 7 monorepo               | L       | Crosses several Astro sites/packages and brings the Vite 8/Rust compiler transition. Migrate all sites together, update integrations, build, and visually smoke routing, islands, MDX, and generated OG images.                                                |
| `@ai-sdk/openai` 4             | Blocked | Birmel's current VoltAgent resolution requires the AI SDK 6/provider-3 generation. Wait for compatible VoltAgent peer ranges, then migrate with AI SDK 7 as one M-sized batch.                                                                                 |
| `ai` 7                         | Blocked | Same VoltAgent peer conflict. Once unblocked, migrate renamed request/callback APIs and run Birmel's classifier plus full agent workflow tests.                                                                                                                |
| `eslint-plugin-unicorn` 69     | M       | Shared config can introduce new or changed rules across most TypeScript workspaces. Update centrally and resolve all repo-wide lint findings.                                                                                                                  |
| `node-av` 6                    | L       | Native multimedia major used by the maintained Discord video-stream fork. Compile native dependencies and test probe, seek, decode, transcode, abort, and real Discord streaming paths.                                                                        |
| React Native Gesture Handler 3 | L       | The Tasks app directly uses `ReanimatedSwipeable`, its methods/types, and the root view. Migrate the swipe row, rebuild Pods/release bundle, and test swiping both directions on device/simulator.                                                             |

## Pending Status Checks

| Update                                            | Effort  | Repository-specific reason and minimum verification                                                                                                                                                                                                         |
| ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-stack-k8s` `0.46.2`                        | M       | Live agent/CI control-plane image. Render, roll, verify scheduling and a representative agent job through completion.                                                                                                                                       |
| React Native Babel preset `0.86.2`                | S       | Batch with React Native `0.86.2`; reinstall Pods and run release-bundle plus native smoke tests.                                                                                                                                                            |
| React Native Metro config `0.86.2`                | S       | Batch with React Native `0.86.2`; validate Metro development and release bundles.                                                                                                                                                                           |
| React Native TypeScript config `0.86.2`           | S       | Batch with React Native `0.86.2`; run the Tasks app typecheck and native builds.                                                                                                                                                                            |
| `devalue` `5.8.2`                                 | XS      | Small patch with no direct source imports found. Run affected builds/tests.                                                                                                                                                                                 |
| `fast-uri` `3.1.4`                                | XS      | Patch on the existing major, primarily indirect/example use. Run affected builds.                                                                                                                                                                           |
| Go `1.26.5`                                       | S       | Toolchain patch across two modules. Run formatting, tests, vet/static analysis, and builds.                                                                                                                                                                 |
| `jeffsteinbok/hass-dreo` `1.10.9`                 | M       | Home Assistant custom-component source and integrity pin. Refresh both, reload the integration, and verify entities/commands.                                                                                                                               |
| `jscpd` `5.0.14`                                  | S       | Repo duplication gate. Run the full check and address any changed detection.                                                                                                                                                                                |
| OpenTofu `1.12.5`                                 | M       | Infrastructure planner/runtime. Run format, init, validate, and no-change plans for every active stack.                                                                                                                                                     |
| Turbo `2.10.7`                                    | M       | Central task graph/cache runner. Exercise full verification, affected selection, cache hits, and CI task discovery.                                                                                                                                         |
| Turborepo remote cache `2.11.5`                   | M       | Live remote-cache service. Roll it and prove authenticated put/get plus real Turbo cache hits.                                                                                                                                                              |
| Grafana `13.1.1`                                  | S       | Detected in the local observability stack. Start the stack and verify provisioning, dashboards, and data sources.                                                                                                                                           |
| Loki `3.7.4`                                      | S       | Local observability-stack patch. Start it and verify ingestion plus a representative query.                                                                                                                                                                 |
| Redis Helm `27.0.18`                              | M       | Stateful chart patch. Regenerate types, render/diff, confirm persistence/backup, and smoke clients after rollout.                                                                                                                                           |
| Home Assistant `2026.7.4`                         | M       | Live automation platform patch. Review breaking changes, back up, roll, and validate core integrations/automations.                                                                                                                                         |
| Kometa `2.4.5`                                    | S       | Media automation patch. Run a dry run or scheduled scan and inspect library changes/logs.                                                                                                                                                                   |
| Scout production image `2.0.0-6556`               | M       | This is a production promotion, not a library bump. Confirm the candidate artifact, promote backend/site in lockstep, then verify release versions, health, and core flows.                                                                                 |
| Starlight Karma Bot production image `2.0.0-6529` | M       | Production promotion over a large build-number gap. Review the intervening product diff, deploy, and exercise Discord commands/events.                                                                                                                      |
| React Native `0.86.2`                             | M       | Native framework patch. Batch the three RN configs, keep Worklets on Reanimated's compatible 0.10 line, reinstall Pods, and validate release bundles, simulator flows, and Xcode Cloud.                                                                     |
| `smol-toml` `1.7.1`                               | XS      | Parser patch used by the game packages. Run config parsing tests and package builds.                                                                                                                                                                        |
| Bugsink `2.5.0`                                   | M       | Database-backed production error tracker. Review migrations, back up, roll, and verify ingestion, issue browsing, and health.                                                                                                                               |
| ClickHouse `26.7`                                 | L       | Stateful database jump across monthly releases. Review migrations/settings, back up, stage the upgrade, then verify storage, representative queries, and dependent ingestion.                                                                               |
| Cloudflared `2026.7.3`                            | S       | Live tunnel connector patch. Roll and verify tunnel status plus every exposed route.                                                                                                                                                                        |
| `fast-xml-builder` `1.3.0`                        | XS      | Only the remaining example pin needs the patch. Build/test the example.                                                                                                                                                                                     |
| Alloy Helm `1.11.0`                               | M       | Telemetry collector chart. Regenerate types, render/diff, roll, and prove logs/metrics/traces still arrive.                                                                                                                                                 |
| Argo CD Helm `10.2.1`                             | L       | GitOps control plane chart. Regenerate types/CRDs, render/diff, upgrade carefully, and verify reconciliation, hooks, and application health.                                                                                                                |
| kube-prometheus-stack Helm `87.19.2`              | L       | Monitoring control plane with CRDs. Regenerate types, render/diff, upgrade, and verify Prometheus, Alertmanager, rules, and Grafana data.                                                                                                                   |
| Pyroscope Helm `2.2.0`                            | M       | Profiling backend chart. Regenerate types, render/diff, roll, and prove profile ingestion/query retention.                                                                                                                                                  |
| Prowlarr `2.5.2`                                  | S       | Live media-service patch. Back up config, roll, and verify indexers plus an application sync.                                                                                                                                                               |
| Z-Wave JS UI `11.22.0`                            | M       | Hardware/home-automation controller. Back up, review device compatibility, roll, and validate representative devices plus Home Assistant integration.                                                                                                       |
| Monaco Editor `0.56`                              | M       | Scout directly embeds Monaco. Build and browser-test editor load, models, syntax, edits, and production asset loading.                                                                                                                                      |
| React Native Worklets `0.11`                      | M       | Native/Babel integration. Batch with React Native `0.86.2`, reinstall Pods, build release bundles, and test all animated/worklet paths.                                                                                                                     |
| Satori `0.29`                                     | L       | Rendering engine used by Astro OG and Scout reports. Rebuild committed snapshots, compare rendered images, and test fonts/layouts across representative reports.                                                                                            |
| OpenTelemetry JS monorepo                         | L       | Shared instrumentation across several services. Update as one compatibility set and verify logs/traces/metrics end to end in the local stack and one deployed service.                                                                                      |
| Prisma `7.9.1` adapter/runtime utilities          | M       | libSQL adapters and generated clients span multiple applications. Regenerate, typecheck, run database tests/migrations, and smoke each adapter consumer.                                                                                                    |
| Rust `base64` `0.23`                              | S       | Narrow desktop encode/decode use. Let compilation drive API changes, then run desktop tests/build.                                                                                                                                                          |
| `tokio-tungstenite` `0.30`                        | M       | Desktop websocket runtime major. Compile, run connection/reconnect/message tests, and exercise the live client boundary.                                                                                                                                    |
| Temporal TypeScript `1.21.1`                      | L       | SDK set spans workers, clients, workflows, activities, and tests. Update atomically, run replay/compatibility tests, and execute representative workflows against Temporal.                                                                                 |
| `linkify-it` 6                                    | XS      | No direct source imports found; likely a root override/tooling dependency. Update alone and run affected tests/builds.                                                                                                                                      |
| Docker 29 image                                   | L       | Buildkite CI image/runtime change. Rebuild/publish the CI image, validate Docker/Buildx API behavior and authentication, then run representative pipelines on the real agents.                                                                              |
| Ubuntu 26 image                                   | XL      | Base-OS major for the custom Redlib image. Reconcile package/library changes, rebuild, and perform full application/runtime and TLS/network smoke testing.                                                                                                  |
| Chevrotain 13                                     | L       | Parser major shared by Cooklang and Scout. Migrate grammar/token APIs and rerun parser fixtures, error cases, snapshots, and consuming applications.                                                                                                        |
| jsdom 30                                          | M       | DOM-runtime major in OG/site tests. Resolve Node/DOM behavior changes and rerun rendering plus browser-oriented test suites.                                                                                                                                |
| tslog 5                                           | L       | Scout backend logger major with custom configuration/integration. Migrate APIs/types and validate structured output, levels, transports, and observability ingestion.                                                                                       |
| TypeScript 7                                      | Blocked | Not a drop-in workspace upgrade: the current typescript-eslint line excludes TypeScript 7, and TS 7 removes the compiler API used by tools. Plan a side-by-side toolchain transition after ecosystem support, then migrate all workspaces as an XL project. |

## Already-Open PRs

| Update                              | Effort | Repository-specific reason and minimum verification                                                                                                                     |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes `1.36.3` — PR #1723      | M      | The cluster currently runs Kubernetes `1.36.2`. Perform the patch upgrade, verify both nodes/control plane/workloads, and only then record `1.36.3` as deployed.        |
| Talos `1.13.7` — PR #1724           | M      | The nodes currently run Talos `1.13.6`. Upgrade safely, run Talos health/etcd/Kubernetes checks, and update the reality pin after success.                              |
| Talos installer `1.13.7` — PR #1725 | M      | Same operational workstream as the Talos PR; the installer and Talos pins must agree. Do not merge it independently of the node upgrade and post-upgrade health checks. |

## Deprecations and Replacements

These are not part of the 79 update count, but they are larger than most of the
queued updates and should be tracked deliberately:

| Dependency                            | Effort | Assessment                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discord.js-selfbot-v13`              | XL     | Archived, ToS-sensitive runtime used across the maintained video-stream stack, game streamers, Streambot, Toolkit, lifecycle helpers, tests, and the Discord skill. Replacement requires a product/architecture decision and end-to-end Discord voice/stream verification. |
| `fluent-ffmpeg`                       | L      | Deeply wrapped by the maintained video-stream fork, including process introspection, progress, filters, abort semantics, stderr parsing, and metrics. Replacing it with direct process/argument management is a dedicated media migration.                                 |
| `@modelcontextprotocol/server-github` | M      | Used by the live MCP gateway plus local MCP configs. Migrate to the supported GitHub MCP server, then verify image packaging, token mapping, tool names, and representative read/write calls.                                                                              |

## Recommended Work Batches

1. **Fast patch sweep:** the XS/S JavaScript patches, fixtures, digest refreshes,
   Go/Rust patches, local Grafana/Loki, Prowlarr, Kometa, and Cloudflared. Keep
   production-image digests as separate deploy-verified PRs even when the edit is
   tiny.
2. **React Native patch wave:** React Native `0.86.2` and its three configs.
   Keep Worklets on Reanimated's compatible 0.10 line; keep Gesture Handler 3
   and Babel 8 separate because they require migrations beyond the patch wave.
3. **Repository tooling wave:** Knip, jscpd, Turbo, typescript-eslint, Unicorn,
   release-please, and OpenTofu. Land one or two at a time so a changed quality
   signal has a clear owner.
4. **Stateful infrastructure, one service at a time:** Redis, SeaweedFS,
   ClickHouse, Bugsink, Argo CD, kube-prometheus-stack, Alloy, Pyroscope, Home
   Assistant, and Z-Wave. Generate types and capture backup/rollback evidence
   before each rollout.
5. **Build/web migrations:** Vite 8 first for the two plain Vite sites, then Astro
   7; keep Helm 4, Docker 29, Emscripten 6, Ubuntu 26, and Babel 8 isolated.
6. **Application compatibility sets:** Prisma, Temporal, OpenTelemetry, Satori,
   Chevrotain, tslog, node-av, and the three deprecation replacements each deserve
   focused PRs with runtime evidence.
7. **Wait on ecosystem prerequisites:** do not force the AI SDK 7/provider 4 or
   TypeScript 7 updates. Revisit after VoltAgent and typescript-eslint/tooling
   explicitly support them.
8. **Finish the live cluster work:** treat PRs #1723–#1725 as a coordinated
   Kubernetes/Talos rollout. The current cluster is still Kubernetes `1.36.2` and
   Talos `1.13.6`, so the existing PR pins are ahead of deployed reality.

## Implementation Outcome

The requested consolidated batch was implemented after this assessment. It
includes the tractable language/tooling updates and all repository-backed
Helm/container/infrastructure targets, with these assessment corrections:

- Vite 8 is excluded after the two Vite 7 sites reproduced an Astro/Tailwind
  resolver incompatibility.
- React Native Worklets `0.11` is excluded because Reanimated still declares the
  0.10 peer line.
- The nginx digest has no active repository pin, and the live BuildKit/buildx
  pin already exceeds the dashboard target.
- Kubernetes, Talos, and the Talos installer remain untouched for the separate
  hardware-coordinated change.

## Session Log — 2026-07-27

### Done

- Consolidated the easy and medium-easy dependency/toolchain updates plus the
  requested Helm, container, and infrastructure pins; refreshed the root
  lockfile, iOS native lockfiles, integrity pins, and generated Helm types.
- Fixed the Emscripten 6, Monaco 0.56, Knip 6, CI-image mise, and parallel Scout
  rendering compatibility issues without suppressing checks or weakening
  assertions.
- Classified the newly merged Buildkite UV and Trivy cache PVCs explicitly as
  rebuildable, backup-disabled data so current-main synthesis stays fail-fast.
- Updated Buildkite's explicit release-please package contract to the new
  `17.10.0` pin after the first clean-checkout CI run exposed the stale value.
- Hardened the pipeline invariant to reject every tagged Docker-in-Docker image,
  including canonical `docker:dind`, with focused regression coverage.
- Replaced the Playwright lane's failing NodeSource/apt Bun bootstrap with the
  pinned Bun 1.3.14 archive, its published SHA-256, Python zip extraction, and
  archive-compatible native `bun x` commands in both the lane and site scripts.
- Kept Kubernetes, Talos, and Talos installer changes out of this branch and
  verified the repository still validates the current Talos `1.13.6` pin.
- Passed `bun run verify -- --affected` with 195/195 tasks, frozen installation,
  Helm 4 generation/linting, Compose rendering, and all targeted custom-image
  builds.
- Published the complete batch as the single git-spice pull request #1735.

### Remaining

- Let Buildkite and code review confirm PR #1735 from a clean remote checkout.
- After merge, monitor GitOps reconciliation and service health for the changed
  production image and chart pins.
- Handle Kubernetes, Talos, and Talos installer updates in their separate
  hardware-coordinated change.

### Caveats

- Vite 8 and the other named major migrations remain excluded after focused
  compatibility assessment; React Native Worklets remains on the Reanimated-
  compatible 0.10 line.
- The dashboard's nginx digest has no active repository pin, while the live
  BuildKit/buildx pin is already newer than the dashboard target.
- Source, build, render, and image validation is complete; live service rollout
  evidence is only available after the GitOps changes merge.
