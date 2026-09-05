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

bunx lefthook run pre-commit    # staged-file checks (Prettier, Gitleaks, …)
bun run verify                  # exhaustive whole-repo gate — what Buildkite runs
```

`bun run verify` is the CI entry point, not part of the everyday loop; run it
locally only to reproduce a Buildkite failure or when changing the verification
machinery itself.

See [AGENTS.md](AGENTS.md) for always-on repository constraints and
[`packages/README.md`](packages/README.md) for the current package catalog.
