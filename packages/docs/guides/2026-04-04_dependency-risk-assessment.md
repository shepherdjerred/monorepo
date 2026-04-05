# Dependency Update Risk Assessment

> Generated 2026-04-04 from Renovate dashboard analysis. Maps each pending update to usage depth, affected packages, and version delta.

## Classification Criteria

- **Easy**: Patch/minor, build-tool-only, types-only, or single-file integration. Merge with green CI.
- **Medium**: Major bump but limited scope (1-3 packages), or lint-only changes. Targeted testing needed.
- **Hard**: Major bump on moderately integrated dep, or framework upgrade touching multiple packages. Dedicated branch + testing session.
- **Extreme**: Ecosystem-wide major bump touching 30+ packages. Multi-day effort.

---

## EASY (16 items) -- Merge immediately with green CI

| Dependency                   | Version Change | Scope                          | Why Low-Risk                             |
| ---------------------------- | -------------- | ------------------------------ | ---------------------------------------- |
| oven/bun Docker tag          | v1.3.10        | Docker image                   | Container patch, no code changes         |
| plexinc/pms-docker           | v1.43.0        | Plex container                 | Media server image, no app code          |
| discord-player               | v7.2.0         | birmel only                    | Minor bump, single consumer              |
| npm                          | v10.9.5        | .dagger only                   | Patch, single file                       |
| @opentelemetry/\*            | v0.213.0       | birmel (1 file)                | Minor, single consumer                   |
| @types/jsdom                 | v27->v28       | 2 pkgs (types-only)            | No runtime impact                        |
| ai                           | v6.0.x         | practice project (1 file)      | Minor, isolated practice project         |
| discord.js                   | v14.26.2       | birmel already at target       | Minor, already there                     |
| java                         | v21.0.10       | Tool patch                     | Patch-level runtime bump                 |
| chevrotain                   | v11->v12       | cooklang-for-obsidian (1 file) | Single consumer, parser lib              |
| discord-player-youtubei      | v1->v2         | birmel only                    | Single consumer                          |
| youtubei.js                  | v16->v17       | birmel only                    | Single consumer                          |
| builtin-modules              | v4->v5         | cooklang-for-obsidian (1 pkg)  | Trivial utility, 1 consumer              |
| npm                          | v10->v11       | .dagger only                   | CI tooling, single file                  |
| react-native-haptic-feedback | v2->v3         | tasks-for-obsidian (1 pkg)     | Tiny API surface                         |
| shiki                        | v3->v4         | sjer.red (1 config line)       | Syntax highlighting, minimal integration |

### Recommended action

Uncheck all 16 in Renovate dashboard to create PRs. Merge each as CI goes green. Can batch the Docker image ones together.

---

## MEDIUM (15 items) -- Targeted testing per affected package

| Dependency                | Version Change | Scope                                    | Notes                            |
| ------------------------- | -------------- | ---------------------------------------- | -------------------------------- |
| @vitejs/plugin-react      | v4->v5         | practice/ packages at v4                 | Build plugin; verify builds work |
| eslint-plugin-react-hooks | v5->v7         | 1 pkg at v5 (discord-plays-pokemon)      | Lint only; fix violations        |
| vitest                    | v3->v4         | 2 pkgs (astro-opengraph-images, webring) | Test runner; run tests           |
| @digital-alchemy/\*       | v25->v26       | homelab/ha (10 files)                    | Smart home only                  |
| astro-seo                 | v0->v1         | examples only (sjer.red already at v1)   | Proven path                      |
| dotenv                    | v16->v17       | scout already at v17                     | Proven path                      |
| eslint-plugin-regexp      | v2->v3         | scout already at v3                      | Proven path                      |
| pino                      | v9->v10        | sentinel (1 file)                        | Logging lib, stable API          |
| jsdom                     | v28->v29       | 2 pkgs (test dep)                        | Test-only                        |
| lucide-react              | v0->v1         | 5 packages                               | Icon lib; import path changes    |
| eslint-plugin-unicorn     | v62->v63       | Multiple packages                        | Lint only; fix new violations    |
| @sentry/react-native      | v7->v8         | clauderon/mobile (tasks already at v8)   | Proven path                      |
| pdfjs-dist                | v4->v5         | monarch (1 pkg)                          | PDF rendering                    |
| react-markdown            | v9->v10        | 3 packages                               | Rendering component              |
| io.jenetics               | v8->v9         | castle-casters (Java)                    | Isolated Java package            |

---

## HARD (9 items) -- Dedicated branch + testing session each

| Dependency                    | Version Change       | Scope                    | Notes                                |
| ----------------------------- | -------------------- | ------------------------ | ------------------------------------ |
| react-native                  | v0.83->v0.84         | 61 files, 2 mobile apps  | Native build chain, deep integration |
| @react-native-community/cli\* | v18->v20             | Mobile build tooling     | Build toolchain, skip v19            |
| vite                          | v6->v7 (then v7->v8) | ~9 packages              | Build tool across frontends          |
| gradle                        | v8->v9               | clauderon/mobile Android | Android builds fragile               |
| node.js major                 | Major                | CI + all packages        | Runtime compatibility                |
| prisma                        | v6->v7               | 22 files, 5 packages     | ORM; schema + migration changes      |
| java                          | v21->v25             | castle-casters + mobile  | Multiple LTS skip                    |
| astro major                   | Major                | 4 sites                  | Framework upgrade                    |
| react-native-reanimated       | v3->v4               | tasks-for-obsidian       | Animation API changes                |

---

## EXTREME (3 items) -- Multi-day strategic efforts

| Dependency     | Version Change | Scope                        | Notes                                             |
| -------------- | -------------- | ---------------------------- | ------------------------------------------------- |
| **zod**        | v3->v4         | **250+ files, 30+ packages** | Core validation infra. Use codemods if available. |
| **eslint**     | v9->v10        | **62 package.json files**    | Linting infra. Config + plugin compat.            |
| **typescript** | v5->v6         | **71 packages**              | Compiler. Type-level breaking changes.            |

---

## Audit Script

```bash
#!/usr/bin/env bash
# usage: ./dep-audit.sh <package-name>
DEP="$1"
echo "=== package.json references ==="
rg "\"$DEP\"" --glob 'package.json' --glob '!node_modules/**' --glob '!archive/**'
echo ""
echo "=== Import statements ==="
rg "from ['\"]$DEP" --glob '*.{ts,tsx,js,jsx}' --glob '!node_modules/**' --glob '!archive/**' -c
echo ""
echo "=== Total files importing ==="
rg "from ['\"]$DEP" --glob '*.{ts,tsx,js,jsx}' --glob '!node_modules/**' --glob '!archive/**' -l | wc -l
```

## Verification

1. For Easy tier: `bun run typecheck && bun run test` after each merge
2. For Medium tier: Run package-specific tests + lint in affected packages
3. For Hard tier: Full build + manual testing of affected apps
4. For Extreme tier: Monorepo-wide typecheck + test + lint, with dedicated migration branches
