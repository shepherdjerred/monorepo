# Renovate Dependency Dashboard #481 Cleanup

## Status

**Session 1 (2026-04-21):** Wave 1 + Wave 5 (safe subset) + Wave 6 complete. Commits `45a995ce1`, `26ac538c`, `ba6b3f768` (hotfix), `e6fbe8f5`, `4b4271b2`, `72c05b240`, `8bc6483b`, `2f09b71c`, `9a555422c`, `297896c7a`.

**Session 2 (2026-04-22):** Additional partial work landed:

- `45a995ce1` — Wave 1 extension (argo-cd 9.5.4, mariadb 25.0.9, redis 25.3.12, plex 1.43.1.10611, bazarr/prowlarr/ubuntu/debian digest refreshes, lombok 1.18.46, Shiki v4 in 2 packages, 10 singleton majors including lucide-react, react-markdown, jsdom, chevrotain, dotenv, pdfjs-dist, uuid, unplugin-fonts)
- `c285f88a7` — Preserve-caught-error improvements in homelab + lockfile refresh (ESLint 10 attempt reverted, blocked upstream by eslint-plugin-react peer)
- `ebd000044` — Fixed 13 scout-for-lol eslint violations (preserve-caught-error + no-useless-assignment; these are core ESLint 9.39+ rules that surfaced after lockfile refresh)
- `f3922d098` — Wave 2b: Vite 8, Vitest 4, @vitejs/plugin-react 6, ts-morph 28, builtin-modules 5
- `da7f0cd30` — @types/node 22→25 in cooklang-for-obsidian + eslint-config (unifying at v25)
- `771446d39` — Wave 3a: Astro v6 in 4 packages (cooklang-rich-preview, astro-opengraph-images, scout-for-lol/frontend, webring/example)
- `be57b1143` — discord-player-youtubei v2 + youtubei.js v17 in birmel
- `b58c8cd64` — Wave 4 partial: webring Zod 4 (standalone, no cross-package cascade)

**Session 2 continued — landed pushes for the remaining cascades:**

- `c8efae8e3` — Wave 4: Zod v4 across tasknotes-types/server/tasks-for-obsidian (schema cascade, z.function → z.custom, z.record shape change, .passthrough → z.looseObject)
- `3c4271c6b` — Wave 3b + 4: Zod 4 in clauderon/mobile + sjer.red, Astro 6 in sjer.red (z.string().url() → z.url(), BlogContent.astro imports z from 'zod' directly now that Astro 6 no longer re-exports it)
- `9ad14ec53` — Wave 5: React Native 0.85.2 cluster in tasks-for-obsidian + clauderon/mobile (RN, community/cli v20, async-storage v3 with multiRemove→removeMany, netinfo v12, sentry-rn cross-major, reanimated v4, haptic-feedback v3, image-picker v8, react-macos 19.2)
- `2df0bc015` — DPP lockfile fix after Zod 4 attempt/revert

**Still deferred (upstream-blocked):**

- **Wave 2a (ESLint 10)** — `eslint-plugin-react@7.37.5` peer caps at `^9.7`; `contextOrFilename.getFilename is not a function` at rule load under v10. Revisit once plugin ships v10.
- **Wave 3 (Prisma v7)** — attempted via `@prisma/adapter-libsql` + prisma.config.ts but blocked by [Bun's incomplete better-sqlite3 support](https://github.com/oven-sh/bun/issues/4290). Tests need explicit `prisma db push` under the new adapter pattern. Reverted for now; will need tests infra rework alongside the Prisma 7 migration.
- **Wave 4 (DPP Zod v4)** — `@d6v/zconf@0.0.4` (latest) signature uses `ZodType<any, ZodTypeDef, any>` which isn't v4-compatible. Affects discord-plays-pokemon/{backend,common,frontend}. Needs upstream update or zconf replacement.
- **Vector-icons deprecation** — `@react-native-vector-icons/<font>` namespaced packages enforce narrow icon-name union types. `AppIcon` / `BrowseItem` / `SavedViewCard` pass `string` through props; migration requires cascading type narrowing across the component tree. Deferred.
- **Wave 5 (prod image promotions)** — scout-for-lol/prod 2.0.0-998 → current (2.0.0-1050+) and starlight-karma-bot/prod 2.0.0-829 → current. Triggers real ArgoCD deployments; needs coordinated maintenance window with user.

Higher-risk framework/RN majors largely handled. Dagger CI has pre-existing infra issues unrelated to these dep updates — see "Dagger CI state" at the bottom.

## Context

Renovate Dashboard #481 accumulated a large backlog: 40+ awaiting-schedule majors, 25+ pending status checks, 4 deprecations, and 6 PRs that were manually closed on 2026-04-05 (Renovate set permanent ignore flags — can't be reopened without manual intervention). User opted to work in-repo (direct package.json / versions.ts edits) rather than re-enabling Renovate PRs one at a time.

## Approach

Six waves grouped by blast radius (see `~/.claude/plans/let-s-work-on-these-replicated-gadget.md` for full wave-by-wave dep list). Lower/medium-risk waves tackled this session; riskier framework migrations deferred.

## This Session — In Scope (Lower/Medium Risk)

### Wave 1 — Deprecation removals + pending-status-check bumps ✅

**Completed:**

- Removed `@types/eslint__js` from `packages/eslint-config/package.json` (ESLint 9+ ships types natively). Lockfile rebuilt, typecheck + 219 tests clean.
- Removed `@types/uuid` from `packages/scout-for-lol/packages/backend/package.json` (no direct `uuid` import in source). Lockfile rebuilt, full scout-for-lol typecheck clean (6 sub-packages).
- `bun update` run per-package across 20+ packages (all fresh timestamps 2026-04-21 17:10+). Pulled caret-range minor/patch updates: `typescript` 6.0.2 → 6.0.3, `@types/bun` 1.3.11 → 1.3.12, `@types/node` 25.5.2 → 25.6.0, `@typescript-eslint/utils` 8.58 → 8.59, `discord.js` 14.26.2 → 14.26.3, `hono` 4.12.10 → 4.12.14, `@ai-sdk/openai` 3.0.50 → 3.0.53, `ai` 6.0.146 → 6.0.168, `@sentry/node` 10.47 → 10.49, `@sentry/react-native` 8.7 → 8.8, `@voltagent/core` 2.6.14 → 2.7.0, `@opentelemetry/resources` 2.6.1 → 2.7.0, `astro` 6.1.3 → 6.1.8, `eslint-plugin-react-hooks` 7.0.1 → 7.1.1, `vitest` 4.1.2 → 4.1.5, `jiti` 2.6.0 → 2.6.1, and dozens more within caret bounds.
- Verified: `homelab` typecheck + lint + tests (67 pass, 5 skip) clean. `scout-for-lol` workspace typecheck (6 packages) clean. `birmel` typecheck clean (Prisma regen included). `toolkit`, `temporal`, `starlight-karma-bot` typecheck clean.

**Known side-effect:** `bun update` also narrowed some `peerDependencies.typescript` ranges from aspirational `^6` → installed `^5.9.3` (e.g., in `eslint-config`). Left as-is; will widen in Wave 2 when TS 6 becomes the repo-wide target.

### Wave 5 — Infrastructure & build tools (safe subset) ✅

**Completed:**

- `packages/homelab/src/cdk8s/src/versions.ts`:
  - `argo-cd` 9.5.2 → 9.5.3
  - `kube-prometheus-stack` 82.18.0 → 83.7.0 (major helm chart bump)
  - `plexinc/pms-docker` → `1.43.0.10492-121068a07-amd64@sha256:b59f6e65a3ec5fad1f5ad417f9911340b71f34efe333338429eeb2dbac5e524e` (closed-PR #503, digest fetched via crane)
  - `cooperspencer/gickup` 0.10.39 → 0.10.40 (digest `sha256:ad28da5fefb031633ef2e23bceaf07bdbfb8e3034ad1b87f36339ae402f531e5` fetched via ghcr anon token)
- `packages/homelab/.cursor/Dockerfile`: dotfiles digest bumped to `sha256:ecd9a70f7d387d1dda97acdd6a649f65f37da44f87fa3d5725a2eb7b616cf654`.
- `packages/starlight-karma-bot/Dockerfile`: `oven/bun:1.3.11` → `oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e`.
- cdk8s `bun run build` synth succeeds with all the edits — manifests still render.

**Deferred/skipped:**

- `linuxserver/qbittorrent` → v20: **false positive.** Docker Hub tag `v20` does not exist for this image; existing `renovate.json` rule restricts to `X.Y.Z` format, so Renovate will not actually propose this. No action.
- `shepherdjerred/scout-for-lol/prod` 2.0.0-998 → latest, `shepherdjerred/starlight-karma-bot/prod` 2.0.0-829 → latest: **deferred** — these are production image pins managed by ArgoCD GitOps. Bumping them triggers actual production deployments (multi-version jumps: scout +25, starlight +194). Out of scope for "lower/medium risk"; needs explicit user promotion.
- `.buildkite/ci-image/Dockerfile` `oven/bun:debian` → `oven/bun:1.3.13`: current `debian` tag digest (`87416c977a...`) already resolves to 1.3.13; this is a cosmetic tag rename, skipped.
- `gradle` → v9, `java` → v25, `io.jenetics:jenetics` → v9, `discord-player-youtubei` v2, `youtubei.js` v17 — deferred (JVM ecosystem + birmel deps need dedicated session).

### Wave 6 — `@github/webauthn-json` deprecation decision ✅

**Decision: leave as-is.** Package still functional (v2.1.1 in `packages/clauderon/web/frontend/`). Migration to `@simplewebauthn/browser` requires API rewrite of registration + auth flows. Tracked in this doc; revisit if a browser-compat bug appears or WebAuthn breaks.

## Deferred to Follow-Up Sessions (Higher Risk)

### Wave 2 — Tooling majors

- `typescript` v5 → v6 MAJOR (some packages already opted in; need full-repo sweep + type-inference fixes)
- `vite` → v8, `vitest` → v4, `@vitejs/plugin-react` → v6
- `eslint` + `@eslint/js` → v10 (flat-config API changes expected)
- `eslint-plugin-react-hooks` → v7, `eslint-plugin-unicorn` → v63, `eslint-plugin-regexp` → v3
- `node` + `@types/node` major (grouped; requires mise/CI runtime bump)
- `npm` → v11
- `ts-morph` → v28

**Why deferred:** ESLint 10 flat-config API changes + TypeScript 6 inference churn need coordinated repair across all packages. Best done in a dedicated session.

### Wave 3 — Framework majors

- **Astro v6 monorepo** across 6 packages (astro-opengraph-images, sjer.red, scout-for-lol/frontend, webring, clauderon/docs, cooklang-rich-preview)
- **Prisma v7 monorepo** (birmel, scout-for-lol/backend) — schema regen + potentially migrations
- **Shiki v4 monorepo**
- **Zod v4** (largest blast radius — every `.parse()` call site; may need error-formatter rewrites)
- `astro-seo` v1, `chevrotain` v12, `dotenv` v17, `pdfjs-dist` v5, `pino` v10, `react-markdown` v10, `jsdom` v29, `lucide-react` v1, `uuid` v14, `unplugin-fonts` v2

**Why deferred:** Zod v4 alone is many hours of schema/error-handling work. Astro v6 has known breaking changes in content collections. Best done incrementally with targeted testing per package.

### Wave 4 — React Native ecosystem (6 closed PRs)

All 6 closed PRs live here. Tightly coupled — must upgrade together per package:

- `react-native` 0.83.1 → 0.84.1 in `packages/tasks-for-obsidian/` + `packages/clauderon/mobile/`
- `@react-native-community/cli` + `platform-android` + `platform-ios` 18 → 20
- `react-macos` 19.1.4 → 19.2.4 (clauderon/mobile only)
- `@react-native-async-storage/async-storage` → v3, `datetimepicker` → v9, `netinfo` → v12
- `@sentry/react-native` → v8, `react-native-image-picker` → v8, `react-native-reanimated` → v4, `react-native-haptic-feedback` → v3
- `react-native-vector-icons` deprecation — migrate to new namespaced `@react-native-vector-icons/*` packages

**Why deferred:** RN 0.84 requires native file patches (ios/ + android/) via the React Native Upgrade Helper, plus `pod install`. Mobile builds validated on actual devices — not quick to smoke-test. Plan a separate focused session.

### Wave 7 — Final quality gate

After all waves complete: run Dagger CI locally across every package (`dagger call` per-pipeline) to mirror Buildkite.

## Critical Files

- `packages/homelab/src/cdk8s/src/versions.ts` — helm chart + docker digest registry (Renovate custom-manager parses `// renovate: …` comments)
- `packages/eslint-config/package.json` — shared ESLint config (already deprecation-cleaned)
- `packages/scout-for-lol/packages/backend/package.json` — already deprecation-cleaned
- `renovate.json` — has allowlist rule for Plex `-amd64` tag suffix; no edit needed

## Verification Commands

```bash
bun install --frozen-lockfile        # per package
bun run scripts/setup.ts             # Prisma/helm-types/HA codegen
bun run typecheck                    # workspace
bun run test                         # workspace
cd packages/<name> && bunx eslint . --fix
cd packages/homelab && bun run synth # cdk8s render check
# final: dagger call <pipeline> per package
```

## Closed-PR Status (Renovate ignore flags)

| PR   | Package                     | Status                               |
| ---- | --------------------------- | ------------------------------------ |
| #503 | plexinc/pms-docker          | Tackled in Wave 5 (versions.ts edit) |
| #514 | react-macos                 | Deferred to Wave 4 session           |
| #515 | react-native                | Deferred to Wave 4 session           |
| #516 | @react-native-community/cli | Deferred to Wave 4 session           |
| #519 | cli-platform-android        | Deferred to Wave 4 session           |
| #521 | cli-platform-ios            | Deferred to Wave 4 session           |

All 6 were manually closed 2026-04-05 — Renovate will not recreate. In-repo upgrade is the only path.

## Dagger CI state (2026-04-21)

Ran `dagger call ci-all --source .` twice after the Wave 1/5/6 commits. Both fail, but NOT due to dep updates. Documented pre-existing ciAllHelper bugs in `.dagger/src/ci.ts` that should be fixed in a separate CI-infra PR:

1. **Rust containers wrong workdir.** `rustBaseContainer(source)` mounts at `/workspace` but `Cargo.toml` lives at `packages/clauderon/`. All `cargo fmt/clippy/test --all-features` fail with "could not find `Cargo.toml`".
2. **Go containers wrong workdir.** Same issue: `go build/test/lint ./...` at `/workspace` fails because `go.mod` is at `packages/terraform-provider-asuswrt/`.
3. **Helm tests need `helm` binary.** `homelab/src/cdk8s/src/helm-template.test.ts` spawns `helm template ...` but bunBaseContainer's apt-get install list does not include `helm`. 8 "Helm Escaping" tests fail with `Executable not found in $PATH: "helm"`.
4. **Clauderon/web workspace deps.** ciAllHelper treats `clauderon/web/client` and `clauderon/web/frontend` as independent packages and only mounts their direct deps from `WORKSPACE_DEPS`. But the real bun workspace root is `packages/clauderon/web/` with a root `package.json` + `bun.lock` linking `@clauderon/shared`, `@clauderon/client`. In Dagger they can't resolve each other → `TS2307: Cannot find module '@clauderon/shared'`.
5. **Scout-for-lol/frontend TS5097 (223 errors).** Locally `astro check` passes cleanly (tsconfig extends `../../tsconfig.base.json` which has `allowImportingTsExtensions: true`). In Dagger the same config fails — suggests `source.directory("packages/scout-for-lol")` may not be exporting the parent `tsconfig.base.json` correctly, or `astro check` uses different resolution in containers.
6. **Pre-existing lint debt.** `clauderon/web/client`, `clauderon/web/frontend`, `clauderon/mobile` have ~15-20 `@typescript-eslint/no-redundant-type-constituents` + `@typescript-eslint/no-unsafe-assignment` errors (from unresolved `@clauderon/shared` types cascading). These appear only in Dagger because shared types resolve locally.

**Fixed in `26ac538c`:**

- `TS5101: Option 'baseUrl' is deprecated` → added `"ignoreDeprecations": "6.0"` to `clauderon/docs`, `clauderon/mobile`, `clauderon/web/frontend` tsconfigs
- `TS5107: moduleResolution=node10 is deprecated` → same fix propagates via `ignoreDeprecations`
- BUN_IMAGE 1.3.11 → 1.3.13 in `.dagger/src/constants.ts`, which should address the "lockfile had changes, but lockfile is frozen" errors (lockfile format mismatch between bun versions)

None of these CI infra issues are regressions from the dep updates in commit `92683837`; they exist on main `4b77c05f` independently.

## Links

- Dashboard issue: shepherdjerred/monorepo#481
- Original session plan: `~/.claude/plans/let-s-work-on-these-replicated-gadget.md`

---

## Session 4 (2026-04-22) — Full sweep + blocked-major disposition

User directive: upgrade ALL dashboard items this session.

### Waves landed

| Wave | Commit      | Scope                                                                                                                                                                                                                                                                                                                             |
| ---- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `495c30cc3` | `@opentelemetry/{exporter-trace-otlp-http,sdk-node}` 0.213 → 0.215 in birmel; `@anthropic-ai/sdk` 0.82 → 0.90 in poc/interview-practice                                                                                                                                                                                           |
| 2    | `710797103` | `eslint-plugin-unicorn` ^62 → ^64 in eslint-config, homelab, scout-for-lol (latest is v64, past dashboard's v63 target)                                                                                                                                                                                                           |
| 3    | `9af9faf8f` | `astro-seo` ^0.8 → ^1.1 in astro-opengraph-images examples (preset, custom)                                                                                                                                                                                                                                                       |
| 4    | `b38a62e95` | `SEMGREP_VERSION` 1.160.0 → 1.161.0 in `.buildkite/scripts/setup-tools.sh` (other CI tool pins re-verified at latest)                                                                                                                                                                                                             |
| 5a   | `a422ea64b` | `io.jenetics:jenetics` 4.4.0 → 9.0.0 in castle-casters. 5-major jump; real API migrations: `DoubleRange.of(int,int)` → `new DoubleRange(double,double)` (record ctor), `Genotype.get(int,int)` → `chromosome.get(int)`, `getBestPhenotype().getGenotype()` → `bestPhenotype().genotype()`. 99 tests pass on Java 25 + jenetics 9. |
| 5b   | `14d885924` | `renovate.json` packageRules disables for `eslint`+`@eslint/js` v10, `prisma`+`@prisma/client` v7, `gradle` v9, and `zod` v4 scoped to `packages/discord-plays-pokemon/**`. Each with a reason comment linking to the blocking upstream condition.                                                                                |
| 6    | `575cd381b` | Pin `@sha256:...` digests on `agent-stack-k8s`, `kueue`, `bitnamilegacy/kubectl` in versions.ts; `ghcr.io/shepherdjerred/dotfiles` in dotfiles/scout/homelab devcontainer+cursor Dockerfiles. Consumer sites strip digest via `.split("@")[0]` where Helm `targetRevision` or image `tag` is passed.                              |
| 7    | `56dd52df2` | Replace deprecated `@github/webauthn-json` with `@simplewebauthn/browser@13` in clauderon/web/frontend (login + registration pages). Two call sites migrated.                                                                                                                                                                     |
| 8    | `923726cb0` | Promote `scout-for-lol/prod` + `starlight-karma-bot/prod` (and betas) from 2.0.0-1038 → 2.0.0-1061, matching current dashboard target.                                                                                                                                                                                            |

### Still-blocked (disabled in renovate.json, session 4)

- **ESLint 10** — `eslint-plugin-react@7.37.5` peer still `eslint: ^9.7`. Re-verify when `eslint-plugin-react@8` ships.
- **Prisma 7** — `@prisma/adapter-better-sqlite3@7.8.0` hits `ERR_DLOPEN_FAILED` (Bun #4290). Re-verify when better-sqlite3 works in Bun or a Bun-native Prisma adapter lands.
- **Gradle 9** — React Native 0.85 gradle plugin targets gradle 8.x. Re-verify when RN 0.86 ships with gradle-9 support.
- **DPP Zod 4** — `@d6v/zconf@0.0.4` still pins `zod: ^3.21.4`. Re-verify when upstream bumps zod.

Each has an `enabled: false` packageRule with a `description` field referencing the blocker, so the dashboard doesn't re-flag them until the condition changes. Remove the rule when the upstream unblocks.

### Out of session 4 (nothing to do)

- `vite@8`, `@vitejs/plugin-react@6`, `discord-player-youtubei@2`, `typescript@6`, `lucide-react@1`, `astro-seo@1` (in sjer.red), `grdb@7.10`, `swift-markdown@0.7.3`, `yams@6.2.1`, `eslint-plugin-react-hooks@7`, `eslint-plugin-regexp@3` — all already at-or-past dashboard target from prior sessions. Dashboard will self-clear on next Renovate scan.
- `linuxserver/qbittorrent` v20 — already suppressed by existing regex rule.

### Commit count

8 commits across 10 actionable waves (wave 9 verification folded into the others; wave 10 renovate.json false-positive cleanup folded into wave 5b).
