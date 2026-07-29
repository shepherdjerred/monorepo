---
id: log-renovate-update-effort-assessment-2026-07-28
type: log
status: complete
board: false
---

# Renovate Update Effort Assessment

## Scope

Estimate the engineering effort for the dependency updates listed on the
Renovate Dependency Dashboard, based on their actual consumers and verification
surfaces in the current monorepo checkout.

Estimates are active engineering time for one engineer, including implementation,
tests, and the relevant local/CI verification. They exclude passive deployment
soak time.

## Scale

| Size    | Active effort                         |
| ------- | ------------------------------------- |
| XS      | Less than 2 hours                     |
| S       | 2–4 hours                             |
| M       | 0.5–1 day                             |
| L       | 1–3 days                              |
| XL      | 3–7 days                              |
| Program | 1–2 weeks or an architecture decision |

## Assessment

### Deprecations and replacements

| Dependency               | Size    | Estimate  | Basis                                                                                                                                                                                                                                                                     |
| ------------------------ | ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discord.js-selfbot-v13` | Program | 5–10 days | Nine declarations span the shared Discord Plays types/lifecycle, two game backends, Streambot, video streaming, and Toolkit. There is no drop-in replacement; the work first requires a supported Discord identity and interaction model, then a cross-package migration. |
| `fluent-ffmpeg`          | L       | 1–2 days  | Only one direct import exists, but it is in the live media-streaming path. Replacing it with a typed Bun subprocess wrapper requires progress/error/stream-lifecycle parity and media integration tests.                                                                  |

### Awaiting schedule

| Update                              | Size      | Estimate                         | Basis                                                                                                                                                                                                                                |
| ----------------------------------- | --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `emscripten/emsdk` digest `3a0d11e` | None      | 0                                | The source is already pinned to this digest and its WASM build was verified in PR #1749. This is stale dashboard state.                                                                                                              |
| nginx digest `5a88c9c`              | None      | 0                                | There is no active nginx image pin in the tracked repository, so there is no source change to make.                                                                                                                                  |
| Babel 8 monorepo                    | L         | 1–3 days                         | One React Native app consumes the four Babel packages. Babel 8 is ESM-only and changes configuration/default behavior; verification includes Metro release bundling, CocoaPods, simulator behavior, and Xcode Cloud Archive.         |
| `fast-uri` 4                        | Wait      | No safe bump now                 | The root override would force v4 under Ajv consumers that declare `^3.0.1`. Wait for Ajv compatibility. A forced validation would cost roughly 0.5–1 day and still leave an unsupported graph.                                       |
| `js-yaml` 5                         | Wait      | No safe bump now                 | The root override would force v5 under Astro, ESLint, and other consumers declaring v4 ranges. Wait for direct consumers to adopt v5.                                                                                                |
| Vite 8                              | L         | 1–2 days                         | Only `sjer.red` and `stocks-sjer-red` remain on Vite 7. A prior attempt found Astro/Tailwind resolver incompatibility. Do this with Astro 7, not as an independent bump.                                                             |
| Astro 7 monorepo                    | XL        | 2–4 days                         | Eight manifests participate. The migration includes Vite 8, stricter Rust-based HTML parsing, Markdown pipeline changes, whitespace differences, builds, route checks, and rendered visual comparison.                               |
| `@ai-sdk/openai` 4                  | Coupled L | Included in 2–4 days below       | Provider v4 depends on the AI SDK 7 model/tool contracts and should not be migrated independently.                                                                                                                                   |
| `ai` 7                              | XL        | 2–4 days with `@ai-sdk/openai` 4 | Birmel uses the SDK across its classifier, memory, and eight agents. The migration changes tools, events, telemetry, prompt fields, and ESM/runtime requirements, so agent fixtures and end-to-end Discord behavior need validation. |
| `eslint-plugin-unicorn` 69          | XL        | 3–7 days                         | The plugin is shared repo-wide. The earlier v67 attempt produced more than 700 findings; adopting the new recommended rules without suppressing them is a dedicated cleanup program.                                                 |
| `node-av` 6                         | XL        | 2–4 days                         | The package backs several native media abstraction and streaming files. Budget includes API migration, native platform/build validation, encoding/stream tests, and Discord streaming integration.                                   |
| `react-native-gesture-handler` 3    | L         | 1–2 days                         | The TypeScript call site is small, but this is a native React Native major. Verification requires pods, Metro release bundle, simulator gestures/navigation, and Xcode Cloud Archive.                                                |

### Pending status checks

| Update                                      | Size                | Estimate         | Basis                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-stack-k8s` 0.46.3                    | S                   | 2–4 hours        | Small chart patch, but it controls CI workers. Regenerate Helm types, render/diff, deploy, and run a representative Buildkite build.                                                                                                             |
| Scout production `2.0.0-6673`               | S                   | 2–4 hours        | The tag is already minted as a backend/site pair. Merge the promotion, then verify Argo CD, backend health, site version, and core Scout flows.                                                                                                  |
| Starlight Karma Bot production `2.0.0-6673` | XS/S                | 1–2 hours        | Straight production promotion with Argo CD rollout and Discord command/event smoke checks.                                                                                                                                                       |
| React 19.2.8                                | None for production | 0                | All tracked production consumers are already at 19.2.8. Only three detached sandbox apps remain at 19.2.7; updating those is less than one hour if they are intentionally maintained.                                                            |
| `kube-prometheus-stack` 87.20.0             | S                   | 2–4 hours        | Chart patch plus generated Helm types, render/diff, rollout, Prometheus/Grafana readiness, rules, and alert-delivery checks.                                                                                                                     |
| SeaweedFS 4.40.0                            | M                   | 0.5–1 day        | This crosses several chart minors for stateful storage. Regenerate types, inspect StatefulSet/PVC/ingress changes, confirm backups, roll out carefully, and smoke-test S3/public object paths.                                                   |
| Satori 0.29                                 | S                   | 2–4 hours        | Two rendering packages consume it. The upstream change is small, but snapshot regeneration and rendered OG/report image comparison are required.                                                                                                 |
| OpenTelemetry JS monorepo                   | L                   | 1–2 days         | Six services/scripts use the SDK/exporters and the root pins Jaeger propagation. The release removes older semantic-convention behavior and deprecates Jaeger propagation; verify traces/logs end-to-end and inspect Grafana/Loki/Tempo.         |
| Temporal TypeScript 1.21.1                  | M                   | 0.5–1 day        | The jump from 1.18 spans Node/runtime and worker payload behavior changes. Run workflow determinism/replay, activity, worker, integration, and homelab test-consumer checks.                                                                     |
| `linkify-it` 6                              | Wait                | No safe bump now | The root override would force v6 under Markdown-It consumers declaring v5 and React Native Markdown Display declaring v2. Wait for those packages to adopt compatible versions.                                                                  |
| PostgreSQL operator 2                       | XL                  | 3–5 days         | Major upgrade of an operator managing several stateful databases. It requires CRD/schema migration analysis, generated types, render/diff, backup/restore readiness, staged GitOps rollout, and validation of every PostgreSQL cluster.          |
| Chevrotain 13                               | S                   | 2–4 hours        | Two parser consumers. The major changes unavailable token/CST location sentinels from `NaN` to `-1`; update location handling and run lexer/parser completion and error-span fixtures.                                                           |
| OpenAI Node 7                               | S                   | 2–4 hours        | The documented breaking change is Node 22 minimum, which the repository toolchain satisfies. Validate the Scout and Temporal API clients plus the shared observability peer range.                                                               |
| TypeScript 7                                | XL                  | 3–7 days         | Sixty-one declarations and custom lint/build tooling are involved. TypeScript 7 initially lacks the compiler API, so tooling consumers may need a deliberate side-by-side TypeScript 6 arrangement before the repo-wide native compiler cutover. |

## Recommended packaging

- Do the low-risk lane first: OpenAI 7, Chevrotain 13, Satori 0.29, Temporal
  1.21.1, the two production promotions, and the small chart patches.
- Treat Astro 7 and the two remaining Vite 8 consumers as one migration.
- Treat AI SDK 7 and `@ai-sdk/openai` 4 as one migration.
- Consider replacing `fluent-ffmpeg` while migrating `node-av` 6 because the same
  media integration suite proves both changes.
- Give PostgreSQL operator 2, Unicorn 69, TypeScript 7, and the selfbot
  replacement dedicated workstreams.
- Do not force `fast-uri`, `js-yaml`, or `linkify-it` across incompatible
  transitive ranges.

## Session Log — 2026-07-28

### Done

- Read the live Dependency Dashboard issue and classified every listed update.
- Mapped each dependency to its tracked consumers and verification surfaces.
- Checked upstream major-version migration notes and prior repository attempts.
- Recorded active-effort estimates and recommended batching in this log.

### Remaining

- None for this read-only assessment. Implementation PRs have not been started.

### Caveats

- Estimates are ranges, not commitments; native builds, production rollouts, and
  stateful chart changes can reveal environment-specific work.
- Passive rollout observation time is not included in the active-effort ranges.
- Renovate should refresh the already-complete emsdk and React production entries.
