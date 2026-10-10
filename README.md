# monorepo

Personal monorepo for active projects, learning, and archived work.

## Highlights

- [homelab](packages/homelab/) — Kubernetes homelab (`torvalds`): Talos, cdk8s, OpenTofu, ArgoCD app-of-apps
- [temporal](packages/temporal/) — Temporal worker running the repo's scheduled automation: agent tasks, homelab audits, and PR-opening refresh jobs
- [scout-for-lol](packages/scout-for-lol/) — Discord bot that tracks friends' League of Legends matches and posts rich post-game reports
- [tasknotes](packages/tasknotes-core/) — the Facet task app family: shared Rust core, [macOS app](packages/tasknotes-macos/), [Windows app](packages/tasknotes-windows/), [sync server](packages/tasknotes-server/), and the [iOS app](packages/tasks-for-obsidian/)
- [toolkit](packages/toolkit/) — CLI developer tools (`pr`, `alerts`, `bugsink`, `grafana`, `discord`, …)
- [birmel](packages/birmel/) — AI-driven Discord bot on an explicit agent runtime
- [monarch](packages/monarch/) — AI transaction categorization pipeline for Monarch Money
- [sjer.red](packages/sjer.red/) — personal website (Astro)
- [astro-opengraph-images](packages/astro-opengraph-images/) and [webring](packages/webring/) — published npm packages

See [packages/README.md](packages/README.md) for the complete package list.

## Other Directories

| Directory                              | Description                                           |
| -------------------------------------- | ----------------------------------------------------- |
| [sandbox/poc/](sandbox/poc/)           | Proof-of-concept experiments                          |
| [sandbox/practice/](sandbox/practice/) | Learning projects - books, courses, coding challenges |
| [sandbox/archive/](sandbox/archive/)   | Archived projects - completed or superseded           |

## Development

```bash
mise install                    # install pinned toolchain (bun, node, tofu, …)
bun install --frozen-lockfile   # one workspace-wide install
bunx turbo run generate         # codegen: Prisma clients, etc.
bunx lefthook install           # arm git hooks

# Day-to-day: run only the tasks for the package you touched
bunx turbo run typecheck test lint --filter=<pkg>

bunx lefthook run pre-commit    # staged-file checks + package typecheck/lint
bun run verify                  # exhaustive whole-repo gate — what CI runs
```

`bun run verify` is the CI entry point, not part of the everyday loop; run it
locally only to reproduce a CI failure or when changing the verification
machinery itself.

Root dependency overrides include temporary security fixes for upstream exact
pins: Prisma 7's `deepmerge-ts` (CVE-2026-40345) and `mysql2`
(GHSA-3f6p-5ww8-9rcr), and Mermaid's Chevrotain dependency on `lodash-es`
(CVE-2026-4800). Remove each override once its upstream dependency resolves a
patched version without it. The deepmerge 8 migration changes recursive Map
merging; repository Prisma configurations use ordinary objects and are verified
through config loading, schema validation, and client generation.

See [AGENTS.md](AGENTS.md) for always-on repository constraints and
[`packages/README.md`](packages/README.md) for the current package catalog.
