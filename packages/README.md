# Packages

One line per package. Each package's own README has the details; `AGENTS.md` files hold contributor/agent process notes.

## Apps & services

| Package                                                         | Description                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [alert-dashboard](alert-dashboard/)                             | Homelab alert dashboard — Postal email ingest, Grafana previews, enforced hexagonal core |
| [birmel](birmel/)                                               | Discord bot on an explicit AI SDK agent runtime                                          |
| [monarch](monarch/)                                             | AI transaction categorization pipeline for Monarch Money                                 |
| [scout-for-lol](scout-for-lol/)                                 | Discord bot tracking friends' League of Legends matches with rich post-game reports      |
| [starlight-karma-bot](starlight-karma-bot/)                     | Discord karma bot — points, leaderboards, scheduled recaps                               |
| [macos-ai-subscription-tracker](macos-ai-subscription-tracker/) | Brim (QuotaBar) — native macOS menu-bar tracker for AI subscription quotas               |
| [temporal](temporal/)                                           | Temporal worker: scheduled automation, agent tasks, homelab audits, PR-opening refreshes |
| [trmnl-dashboard](trmnl-dashboard/)                             | TRMNL e-ink dashboard backend aggregating home/homelab status                            |

## Discord streaming

| Package                                               | Description                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| [discord-plays-core](discord-plays-core/)             | Shared engine for the Discord Plays projects (streaming, web server, bot entry) |
| [discord-plays-mario-kart](discord-plays-mario-kart/) | Cooperative Mario Kart 64 played from Discord via a headless N64 emulator       |
| [discord-plays-pokemon](discord-plays-pokemon/)       | Discord Plays Pokémon — headless emulator + Go-Live stream                      |
| [discord-stream-lifecycle](discord-stream-lifecycle/) | XState v5 machines managing Go-Live sessions, userbot pools, and playback       |
| [discord-video-stream](discord-video-stream/)         | Maintained fork of `@dank074/discord-video-stream` powering the Go-Live stack   |
| [streambot](streambot/)                               | Discord video streaming orchestrator with per-guild sessions and token leases   |

## TaskNotes

| Package                                   | Description                                                    |
| ----------------------------------------- | -------------------------------------------------------------- |
| [tasknotes-core](tasknotes-core/)         | Shared Rust core (domain, sync, recurrence) + UniFFI bindings  |
| [tasknotes-macos](tasknotes-macos/)       | Facet for macOS — native SwiftUI app over the Rust core        |
| [tasknotes-server](tasknotes-server/)     | TaskNotes sync server (Bun + Hono)                             |
| [tasknotes-windows](tasknotes-windows/)   | Facet for Windows — native WinUI app over the Rust core        |
| [tasknotes-types](tasknotes-types/)       | Shared TypeScript/Zod schemas for TaskNotes                    |
| [tasknotes-fixtures](tasknotes-fixtures/) | Language-neutral JSON oracles shared by the TS and Rust cores  |
| [tasks-for-obsidian](tasks-for-obsidian/) | Facet for iOS — React Native app synced with an Obsidian vault |

## Websites

| Package                                         | Description                                                  |
| ----------------------------------------------- | ------------------------------------------------------------ |
| [sjer.red](sjer.red/)                           | Personal website (Astro)                                     |
| [resume](resume/)                               | LaTeX resume, built and deployed from CI                     |
| [stocks-sjer-red](stocks-sjer-red/)             | PC-component investment portfolio tracker (Astro)            |
| [cooklang-rich-preview](cooklang-rich-preview/) | Marketing site for the Cooklang Rich Preview Obsidian plugin |
| [glitter](glitter/)                             | Glitter Boys friend-group site                               |

## Libraries

| Package                                           | Description                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| [astro-opengraph-images](astro-opengraph-images/) | Astro integration generating Open Graph images (published to npm)              |
| [webring](webring/)                               | RSS-fed webring component (published to npm)                                   |
| [code-review](code-review/)                       | Provider-neutral PR review-signal library (Codex, Greptile) behind the CI gate |
| [eslint-config](eslint-config/)                   | Shared ESLint flat config used by every package                                |
| [glitter-context](glitter-context/)               | Typed friend-group context data (people, lore, style cards)                    |
| [home-assistant](home-assistant/)                 | Type-safe Home Assistant client + schema codegen                               |
| [llm-models](llm-models/)                         | Language-neutral LLM model catalog (JSON + schema) with upstream pricing sync  |
| [llm-observability](llm-observability/)           | LLM tracing/metrics: OTel wrappers + S3 span-body archive                      |

## Plugins & extensions

| Package                                         | Description                                                  |
| ----------------------------------------------- | ------------------------------------------------------------ |
| [better-skill-capped](better-skill-capped/)     | Web client rebuilding Skill Capped's catalog UI              |
| [cooklang-for-obsidian](cooklang-for-obsidian/) | Obsidian plugin rendering `.cook` recipes with rich previews |

## Infrastructure & tooling

| Package                                                   | Description                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| [homelab](homelab/)                                       | Kubernetes homelab: Talos, cdk8s, OpenTofu, ArgoCD                       |
| [terraform-provider-asuswrt](terraform-provider-asuswrt/) | Terraform/OpenTofu provider for Asuswrt-Merlin routers                   |
| [toolkit](toolkit/)                                       | CLI developer tools (`pr`, `alerts`, `bugsink`, `grafana`, `discord`, …) |
| [pr-fleet-controller](pr-fleet-controller/)               | Mastra controller that drives the open-PR fleet with a live dashboard    |
| [release-tools](release-tools/)                           | release-please wrapper for the release lane                              |
| [dotfiles](dotfiles/)                                     | Dotfiles & shell config (chezmoi source)                                 |
| [fonts](fonts/)                                           | Berkeley Mono Nerd Fonts patcher                                         |

## Learning & reference

| Package                 | Description                                      |
| ----------------------- | ------------------------------------------------ |
| [anki](anki/)           | Anki decks generated from markdown study notes   |
| [leetcode](leetcode/)   | Local LeetCode search engine (FTS5 + embeddings) |
| [docs/wiki](docs/wiki/) | Human-first public systems wiki                  |
