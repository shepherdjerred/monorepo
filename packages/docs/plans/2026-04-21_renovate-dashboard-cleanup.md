# Renovate Dependency Dashboard #481 Cleanup

## Status

**Wave 1 + Wave 5 (safe subset) + Wave 6 complete, uncommitted (2026-04-21)** — Lower/medium-risk waves done this session. High-risk framework/RN majors deferred.

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

## Links

- Dashboard issue: shepherdjerred/monorepo#481
- Original session plan: `~/.claude/plans/let-s-work-on-these-replicated-gadget.md`
