# monorepo

Personal monorepo for active projects, learning, and archived work.

## Packages

<!--[[[cog
import cog
import subprocess
import pathlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone

MODEL = "gpt-5-codex"
GITHUB_URL = "https://github.com/shepherdjerred/monorepo/tree/main/packages"
TECH_KEYWORDS = (
    "typescript", "javascript", "bun", "node", "react", "vite", "astro", "hono",
    "rust", "tokio", "python", "go", "java", "kotlin", "prisma", "sqlite",
    "postgres", "docker", "kubernetes", "aws", "cloudflare", "discord"
)
BANNED_PHRASES = (
    "i do not have enough information",
    "there is only",
    "appears to be",
    "likely",
    "possibly",
    "might",
    "suggests",
    "probably",
    "cannot access any project details",
)

def read_file_excerpt(path, max_chars=2000):
    try:
        return path.read_text(errors="ignore")[:max_chars]
    except Exception:
        return ""

def gather_source_context(folder_path, max_chars=14000):
    """Gather context from source files when no README exists."""
    context_parts = []

    # Prefer the project's own README when available.
    readme_text = read_file_excerpt(folder_path / "README.md", 3000)
    if readme_text:
        context_parts.append(f"README.md:\n{readme_text}")

    # Check package.json
    pkg_json = folder_path / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            context_parts.append(
                "package.json:\n"
                f"name={pkg.get('name')}\n"
                f"description={pkg.get('description')}\n"
                f"scripts={list(pkg.get('scripts', {}).keys())[:12]}\n"
                f"dependencies={list(pkg.get('dependencies', {}).keys())[:20]}"
            )
        except Exception:
            pass

    # Check Cargo.toml
    cargo_toml = folder_path / "Cargo.toml"
    if cargo_toml.exists():
        context_parts.append(f"Cargo.toml:\n{read_file_excerpt(cargo_toml, 1400)}")

    # Check pyproject.toml
    pyproject = folder_path / "pyproject.toml"
    if pyproject.exists():
        context_parts.append(f"pyproject.toml:\n{read_file_excerpt(pyproject, 1400)}")

    # Pull representative source files from common roots.
    code_exts = {".ts", ".tsx", ".js", ".jsx", ".rs", ".py", ".go", ".java", ".kt", ".swift", ".rb", ".sh"}
    skip_dirs = {"node_modules", "dist", "build", "target", ".git", "vendor", ".next", ".turbo"}
    source_roots = ["src", "app", "api", "web", "core", "cli"]
    collected = 0

    for root in source_roots:
        root_path = folder_path / root
        if not root_path.exists() or not root_path.is_dir():
            continue
        for fp in sorted(root_path.rglob("*")):
            if collected >= 6:
                break
            if not fp.is_file():
                continue
            if any(part in skip_dirs for part in fp.parts):
                continue
            if fp.suffix.lower() not in code_exts:
                continue
            rel = fp.relative_to(folder_path)
            context_parts.append(f"{rel}:\n{read_file_excerpt(fp, 1400)}")
            collected += 1
        if collected >= 6:
            break

    # List directory structure
    try:
        files = [f.name for f in folder_path.iterdir() if not f.name.startswith('.')][:30]
        context_parts.append(f"Files: {', '.join(files)}")
    except Exception:
        pass

    return "\n\n".join(context_parts)[:max_chars]

def summary_has_quality(summary):
    text = summary.strip()
    if len(text) < 170:
        return False
    lower = text.lower()
    if any(phrase in lower for phrase in BANNED_PHRASES):
        return False
    if len([s for s in re.split(r"[.!?]+", text) if s.strip()]) < 2:
        return False
    if not any(keyword in lower for keyword in TECH_KEYWORDS):
        return False
    return True

def generate_summary(content, prompt, summary_path):
    """Generate summary using Codex CLI and cache it."""
    schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "confidence": {"type": "number"},
            "tech": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["summary", "confidence", "tech"],
        "additionalProperties": False,
    }
    full_prompt = f"{prompt}\n\nProject context:\n{content}"

    with tempfile.TemporaryDirectory() as tmpdir:
        schema_path = pathlib.Path(tmpdir) / "schema.json"
        out_path = pathlib.Path(tmpdir) / "summary.json"
        schema_path.write_text(json.dumps(schema))

        env = dict(os.environ)
        if env.get("OPENAI_API_KEY") and not env.get("CODEX_API_KEY"):
            env["CODEX_API_KEY"] = env["OPENAI_API_KEY"]

        result = subprocess.run(
            [
                "bunx",
                "@openai/codex",
                "exec",
                # Ignore AGENTS.md/CLAUDE.md project docs so codex returns just a
                # project summary, not agent session-log meta (Done/Remaining/Caveats).
                "-c",
                "project_doc_max_bytes=0",
                "--model",
                MODEL,
                "--sandbox",
                "read-only",
                "--output-schema",
                str(schema_path),
                "-o",
                str(out_path),
                full_prompt,
            ],
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )

        if result.returncode != 0 or not out_path.exists():
            import sys
            print(f"[cog] codex failed for {summary_path}: rc={result.returncode}", file=sys.stderr)
            if result.stderr:
                print(f"[cog]   stderr: {result.stderr[:500]}", file=sys.stderr)
            return None

        try:
            payload = json.loads(out_path.read_text())
            description = str(payload.get("summary", "")).strip()
        except Exception:
            return None

    if description and summary_has_quality(description):
        summary_path.write_text(description + "\n")
        return description
    return None

packages_dir = pathlib.Path(cog.inFile).parent / "packages"
subdirs_with_dates = []

for d in packages_dir.iterdir():
    if d.is_dir() and not d.name.startswith('.'):
        try:
            result = subprocess.run(
                ['git', 'log', '--diff-filter=A', '--follow', '--format=%aI', '--reverse', '--', f'packages/{d.name}'],
                capture_output=True, text=True, timeout=5, cwd=packages_dir.parent
            )
            if result.returncode == 0 and result.stdout.strip():
                date_str = result.stdout.strip().split('\n')[0]
                commit_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                subdirs_with_dates.append((d.name, commit_date))
            else:
                subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))
        except Exception:
            subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))

cog.outl(f"**{len(subdirs_with_dates)} active packages**\n")
subdirs_with_dates.sort(key=lambda x: x[1], reverse=True)

for dirname, commit_date in subdirs_with_dates:
    folder_path = packages_dir / dirname
    readme_path = folder_path / "README.md"
    summary_path = folder_path / "_summary.md"
    date_formatted = commit_date.strftime('%Y-%m-%d')
    github_url = f"{GITHUB_URL}/{dirname}"

    cog.outl(f"### [{dirname}]({github_url}) ({date_formatted})\n")

    if summary_path.exists():
        cog.outl(summary_path.read_text().strip())
    else:
        # Always scan source files for summary
        context = gather_source_context(folder_path)
        if context:
            prompt = (
                "Write 2-3 specific sentences about this project. Include: "
                "(1) what it does, "
                "(2) concrete technologies/frameworks visible in the files, and "
                "(3) one notable capability or architecture detail. "
                "Do not use hedging language (likely/might/appears). No emoji."
            )
            desc = generate_summary(context, prompt, summary_path)
            cog.outl(desc if desc else "*No description available.*")
        else:
            cog.outl("*No description available.*")
    cog.outl()
]]]-->

**37 active packages**

### [scout-for-lol](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol) (2026-07-20)

Scout for League of Legends is a Discord bot that tracks your friends’ matches and delivers post-game notifications with rich stat reports directly into your server. The codebase uses React, the Tauri app framework, Zod validation, ffmpeg-static, and both OpenAI and Google Generative AI SDKs (`package.json`). It runs configurable competitions, supports multi-region player tracking, and generates full arena-mode reports for all teams with augment and placement data.

### [docs](https://github.com/shepherdjerred/monorepo/tree/main/packages/docs) (2026-07-20)

---

id: reference-summary
type: reference
status: complete
board: false

---

# Summary

Monorepo Documentation is an AI-maintained knowledge base that captures architecture, decisions, guides, plans, and logs for the wider monorepo. The collection is organized as Markdown directories like `architecture/`, `patterns/`, and `guides/`, with automation hooks that rely on Bun scripts and Temporal scheduling workflows. A notable capability is the `temporal-agent-task` annotation system that lets operators trigger follow-up runs through the Temporal agent-task scheduler via `bun run scripts/schedule-agent-task.ts`.

### [docs-board](https://github.com/shepherdjerred/monorepo/tree/main/packages/docs-board) (2026-07-19)

Docs Workboard provides a local macOS kanban-style dashboard that scans `packages/docs/**/*.md`, renders workflow metadata, and writes status transitions, comments, and archival moves back to the same Markdown files. The project runs on Bun scripts with a Vite-built React client, a Hono server, shared tRPC router with Zod validation, and client features powered by TanStack React Query, DnD Kit, Lucide, and Tailwind utilities. The server maintains an indexed in-memory snapshot of validated documents and streams typed SSE updates, so opening a card is an ID lookup while React Query instantly caches and invalidates board data.

### [discord-plays-core](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-core) (2026-07-12)

This project provides the shared core for Discord-plays game bots, standardizing tracing, metrics, audio transport, and bot bootstrapping so Pokémon and Mario Kart streams run identically. It is built with Bun, Discord.js, Express, prom-client metrics, OpenTelemetry tracing, Sentry monitoring, and XState-driven lifecycle logic surfaced in the provided source files. A notable architecture detail is the package-wide `./*` subpath exports that publish modules such as `observability/tracing.ts` and `stream/audio-transport.ts`, enabling each game to plug in custom emulators while reusing the uniform lifecycle scaffolding.

### [llm-models](https://github.com/shepherdjerred/monorepo/tree/main/packages/llm-models) (2026-06-27)

This package provides a language-neutral catalog of active LLM models with pricing and capability metadata for downstream applications. It uses TypeScript validated with Zod, backed by tooling in `eslint.config.ts`, `tsconfig.json`, and a Python layer that reuses the schema via Pydantic. A notable architecture detail is that `catalog.json` serves as the single source of truth, with the TypeScript module loading and exposing typed accessors that mirror the same data for every language.

### [glitter](https://github.com/shepherdjerred/monorepo/tree/main/packages/glitter) (2026-06-15)

Glitter is a Node.js project configured to deploy a static site served directly from the `public` directory. It uses npm packaging defined in `package.json` and organizes all frontend assets under `public`. The dedicated `deploy` npm script highlights its streamlined, dependency-free static-site architecture.

### [discord-stream-lifecycle](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-stream-lifecycle) (2026-06-13)

The @shepherdjerred/discord-stream-lifecycle package provides shared XState v5 state machines that manage Discord Go-Live streaming sessions end-to-end. It is implemented in strict TypeScript with Bun-managed tooling (`bun.lock`), uses XState’s `setup` API, and relies on Node stream primitives to coordinate encoders and voice targets. A notable architecture detail is the layered setup where `createDesiredStreamMachine` composes a raw go-live machine actor to reconcile desired intent with actual Discord topology, handling retries and teardown reasons per snapshot.

### [discord-video-stream](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-video-stream) (2026-06-07)

@shepherdjerred/discord-video-stream is a monorepo-maintained fork of @dank074/discord-video-stream that gives streambot, discord-plays-pokemon, and discord-plays-mario-kart a unified Go-Live streaming library. The codebase is TypeScript built via Bun (`bun run build`) and depends on `fluent-ffmpeg`, `discord.js-selfbot-v13`, `sharp`, `@lng2004/node-datachannel`, and related WebRTC tooling. A notable upgrade is the seekable player in `src/media/player.ts` that restarts ffmpeg with an `-ss` offset while preserving the existing Discord Go-Live connection so scrubbing triggers no visible stream interruption.

### [discord-plays-mario-kart](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-mario-kart) (2026-06-06)

The project runs Mario Kart 64 headlessly as a cooperative Twitch Plays–style experience where up to four Discord users drive karts in real time from a web UI while the race streams into a voice channel. It relies on a Bun-executed WebAssembly build of a patched N64Wasm core, Socket.IO for controller inputs, and ffmpeg with the in-repo `@shepherdjerred/discord-video-stream` fork to deliver live video. A notable capability is the custom patch series that injects the ROM directly into wasm memory, exposes the angrylion software framebuffer, and replays per-seat inputs each frame so four virtual controllers stay synchronized without a GPU.

### [streambot](https://github.com/shepherdjerred/monorepo/tree/main/packages/streambot) (2026-06-06)

Streambot orchestrates Discord video streaming sessions across guilds, letting users queue, play, and manage media via slash commands and status reporting. It runs on Bun with TypeScript, using `discord.js` alongside `discord.js-selfbot-v13`, `xstate`, `zod`, and `prom-client`, plus internal @shepherdjerred packages for command handling and streaming helpers. Configuration is validated once at startup through branded Zod schemas that feed a session manager which leases distinct userbot tokens so each account streams only one voice channel concurrently.

### [stocks-sjer-red](https://github.com/shepherdjerred/monorepo/tree/main/packages/stocks-sjer-red) (2026-05-24)

stocks-sjer-red is an Astro-based application that tracks a PC component investment portfolio by loading structured JSON data and computing holdings, cost basis, and performance metrics. It is built with Astro, TypeScript, Tailwind CSS, and Zod, leveraging runtime validation before executing pricing and aggregation logic. A notable capability is the strict Zod `PortfolioSchema`, which guarantees clean component histories so calculations like current totals and percentage changes remain reliable.

### [llm-observability](https://github.com/shepherdjerred/monorepo/tree/main/packages/llm-observability) (2026-05-19)

The @shepherdjerred/llm-observability package captures and traces LLM interactions so downstream systems can inspect chat requests, responses, and token usage across providers. It is built in TypeScript with Bun tooling and relies on OpenTelemetry APIs together with Zod schemas defined in modules like `src/config.ts` and the provider wrappers in `src/*-wrapper.ts`. A dedicated archive pipeline combines `ArchiveSpanProcessor` with the S3 `uploadArchive` helper to strip large span bodies, gzip them, and store slim references keyed by service, provider, and date so Tempo and S3 remain synchronized.

### [trmnl-dashboard](https://github.com/shepherdjerred/monorepo/tree/main/packages/trmnl-dashboard) (2026-05-09)

TRMNL Dashboard is a Bun standard-library HTTP service that exposes liveness, health, home, and homelab JSON endpoints for TRMNL Private Plugins. The codebase uses TypeScript with Bun tooling (`bun:test`, `bun.lock`), Zod validation, and the `@shepherdjerred/home-assistant` package to structure payloads. Its architecture collects status data from Home Assistant, Prometheus, Alertmanager, Bugsink, PagerDuty, and Kubernetes, enforcing access via an `x-api-key` header to deliver unified diagnostics.

### [home-assistant](https://github.com/shepherdjerred/monorepo/tree/main/packages/home-assistant) (2026-04-20)

This package provides a strongly typed client that lets JavaScript automation connect to the Home Assistant REST and WebSocket APIs for state queries and service calls. The codebase is written in TypeScript, targets both Bun and Node.js runtimes, and relies on Zod to validate responses while exposing CLI tooling in `src/codegen/cli.ts` and runtime exports in `src/index.ts`. Its standout capability is the `ha-codegen` CLI, which introspects a live Home Assistant instance to emit a schema module that enforces compile-time safety for entity IDs, domains, services, and event payloads.

### [temporal](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal) (2026-04-07)

This project runs a Temporal-based automation service that orchestrates AI agent workflows, alert remediation, and GitHub operations for the shepherdjerred monorepo. It is implemented in Bun with TypeScript using Temporal’s SDK, OpenTelemetry instrumentation, Sentry, Zod, Octokit, and Kubernetes client libraries defined in `package.json`. A notable capability provisions per-task work directories, validates agent outputs against JSON schemas, and launches alert remediation child tasks that can branch fixes into draft PRs.

### [leetcode](https://github.com/shepherdjerred/monorepo/tree/main/packages/leetcode) (2026-03-27)

This project provides a local LeetCode search engine that ingests the official problem catalog, editorials, and builds an on-disk database for fast querying. It uses Bun scripts with `bun:sqlite`, a SQLite FTS5 index, and Python dependencies orchestrated through `uv` alongside MLX-based `bge-m3` embedding generation. The search pipeline fuses BM25 keyword hits and 1024-dimension vector similarities via Reciprocal Rank Fusion to deliver hybrid semantic and keyword retrieval from `data/leetcode.db`.

### [toolkit](https://github.com/shepherdjerred/monorepo/tree/main/packages/toolkit) (2026-03-26)

@shepherdjerred/tools is a TypeScript CLI that fetches and formats operational data from Bugsink, PagerDuty, and GitHub to streamline incident response workflows. The codebase runs on the Node.js toolchain defined in package.json, compiles TypeScript sources, and brings in the zod validation library. Command modules in src/commands—such as pr/health.ts—share formatter utilities to deliver modular features like PR health checks that bundle merge-conflict detection with CI status aggregation.

### [cooklang-rich-preview](https://github.com/shepherdjerred/monorepo/tree/main/packages/cooklang-rich-preview) (2026-03-15)

This project delivers the marketing site promoting the Cooklang Rich Preview Obsidian plugin. It is built with Astro, Tailwind CSS, PostCSS, and TypeScript-driven tooling such as `astro-icon` and `@iconify-json/heroicons`. The Astro configuration links `.astro/types` through `src/env.d.ts`, giving the site strongly typed component and environment support.

### [cooklang-for-obsidian](https://github.com/shepherdjerred/monorepo/tree/main/packages/cooklang-for-obsidian) (2026-03-06)

Cooklang Rich Preview is an Obsidian plugin that renders `.cook` recipe files with rich previews, ingredient highlighting, timers, and metadata cards inside the vault. The codebase uses TypeScript with the Obsidian plugin API, CodeMirror editor bindings, and a Chevrotain-powered parser compiled via esbuild and Bun scripts. A custom `CookView` pairs a CodeMirror editor with a live renderer that builds section-aware recipe layouts and metadata cards from the structured parse tree.

### [terraform-provider-asuswrt](https://github.com/shepherdjerred/monorepo/tree/main/packages/terraform-provider-asuswrt) (2026-03-01)

This project implements a Terraform/OpenTofu provider that manages Asuswrt-Merlin routers by orchestrating their HTTP-based NVRAM configuration endpoints. It is written in Go 1.25, using HashiCorp’s Terraform Plugin Framework along with tooling wired through `GNUmakefile`, `go.mod`, and `go.sum`. The internal client and provider packages expose resources such as `asuswrt_system` and `asuswrt_dhcp_static_lease`, translating Terraform CRUD operations into router API calls.

### [tasknotes-types](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-types) (2026-02-28)

tasknotes-types delivers a reusable schema library that enforces strict typing across task management concepts—covering priorities, statuses, reminders, time tracking, pomodoro state, calendar events, and API request/response shapes. It is implemented in TypeScript with Zod validation, linted via `eslint.config.ts`, and managed through Bun tooling (`bun.lock`) alongside the root `tsconfig.json`. The `src/index.ts` barrel consolidates all schemas so downstream services can import consistent models for tasks, filters, NLP parsing, and health checks from a single entrypoint.

### [tasknotes-server](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-server) (2026-02-26)

Tasknotes Server is a Bun-powered backend that turns Markdown frontmatter into typed task records and exposes automation routes for health checks, NLP parsing, calendars, pomodoro timers, and time tracking. It relies on the Hono HTTP framework with Bun-native testing (`bun:test`), Zod validation, Gray Matter parsing, Prometheus metrics via `prom-client`, and Sentry integration for runtime telemetry. A natural-language parser maps inputs like “Fix bug !high p:Backend @office” into structured priorities, projects, contexts, and tags before persisting them through the vault-backed `TaskStore`.

### [tasks-for-obsidian](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasks-for-obsidian) (2026-02-23)

Tasks-for-obsidian delivers a React Native mobile client for managing synchronized tasks tied to an Obsidian-centered workflow, complete with in-app sync status and offline cues. It relies on a TypeScript-based stack with React Native, React Navigation, react-native-reanimated, Safe Area Context, and Sentry instrumentation plus vector icon and gesture libraries. A notable capability is the animated connection banner and Kanban board architecture that leverages shared Reanimated state, safe-area awareness, and typed domain models to orchestrate task columns while signaling authentication and sync conditions.

### [monarch](https://github.com/shepherdjerred/monorepo/tree/main/packages/monarch) (2026-02-21)

Monarch is an AI-driven transaction categorizer for Monarch Money that processes bank data, enriches it with Amazon, Venmo, and Bilt sources, and applies Claude-based merchant classifications. It runs on Bun with a TypeScript codebase that pulls in the Anthropic SDK, Playwright scrapers, pdfjs-dist parsing, and Zod validation across scripts like `src/index.ts` and its supporting libraries. The architecture uses a multi-tier Claude classifier pipeline with a persistent knowledge base that reconciles Amazon orders to transactions and tracks enrichment statistics.

### [homelab](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab) (2026-02-15)

Homelab provisions and manages a Kubernetes-driven personal infrastructure cluster named `torvalds`, delivering fully automated deployments and backups through ArgoCD orchestration. The repo uses TypeScript with cdk8s built and bundled by Bun, paired with Talos control-plane scripts and generated Helm chart typings under `src/cdk8s/generated/helm`. It enforces an ArgoCD app-of-apps architecture with dependency pinning and automated updates that keep Docker images, Helm charts, and Bun packages current.

### [anki](https://github.com/shepherdjerred/monorepo/tree/main/packages/anki) (2026-02-15)

This package automates turning Markdown study notes (`book_high_performance_web_applications.md`, `book_ostep.md`, `bytes.md`, `interview.md`) into Anki decks by invoking the mdanki CLI to emit `.apkg` files. The `generate.sh` workflow relies on Node.js tooling (`npx`, `mdanki`, `sql.js`) plus a shared `settings.json` template that defines the card HTML and CSS, and it swaps in the `sql-memory-growth.js` build of sql.js before running the conversions so every deck is generated with the memory-growth WebAssembly runtime.

### [astro-opengraph-images](https://github.com/shepherdjerred/monorepo/tree/main/packages/astro-opengraph-images) (2026-02-15)

This project ships an Astro integration that generates Open Graph images for every page in a static Astro build. It is written in TypeScript and relies on React-based presets powered by Satori and the @resvg/resvg-js renderer. During the astro:build:done hook it sanitizes HTML with jsdom, extracts Open Graph metadata, and renders customizable presets that cover Astro content collections.

### [better-skill-capped](https://github.com/shepherdjerred/monorepo/tree/main/packages/better-skill-capped) (2026-02-15)

Better Skill Capped is a React web app that rebuilds Skill Capped’s catalog into a richer interface driven by the service’s embedded video manifest. It is built with TypeScript, Vite, Bulma styling, Font Awesome icons, Fuse.js search utilities, and Sentry monitoring. The UI persists bookmarks and viewing status through localStorage-backed datastores, giving users personalized tracking alongside the enhanced catalog view.

### [discord-plays-pokemon](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-pokemon) (2026-02-15)

Discord Plays Pokémon lets a Discord server collectively play Pokémon Emerald by routing chat button commands into a fully headless emulator stream. The repo centers on a Bun runtime driving the vendored `pokeemerald-wasm`, encodes frames with `ffmpeg`, and delivers them over the forked `@shepherdjerred/discord-video-stream` stack into a Discord voice channel. The `packages/backend/assets/pokeemerald.wasm` binary is built from source (ottohg's fork plus a small export patch) during the Dagger image build rather than committed, and Renovate advances the pinned upstream commit so deployments through ArgoCD stay current without manual intervention.

### [dotfiles](https://github.com/shepherdjerred/monorepo/tree/main/packages/dotfiles) (2026-02-15)

This repository is a personal monorepo aggregating active projects, learning experiments, and archived work under a shared workspace `README.md:3`. It uses a Bun-powered TypeScript setup with declared workspaces, Lefthook git hooks, Dagger tooling, and Tauri API dependencies managed through `package.json:1`. A notable capability is the Bun automation script `scripts/run-package-script.ts:1`, which discovers every package under `packages/*` and executes a requested script across them while honoring skip lists for selective runs.

### [sjer.red](https://github.com/shepherdjerred/monorepo/tree/main/packages/sjer.red) (2026-02-15)

This repo powers the sjer.red personal site, delivering blog posts, curated bookmarks, and other content through Astro-driven static pages. It runs on Astro with plugins like @astrojs/mdx, @astrojs/rss, Tailwind CSS, and Node-based utilities such as `src/bookmarks/bookmarks.ts` that use jsdom and Zod to automate bookmark ingestion, giving the site an automated link curation pipeline.

### [starlight-karma-bot](https://github.com/shepherdjerred/monorepo/tree/main/packages/starlight-karma-bot) (2026-02-15)

Starlight Karma Bot is a Discord bot that manages karma points, leaderboards, and history commands for servers. It runs on Bun with discord.js v14, TypeORM backed by SQLite, dotenv/env-var configuration helpers, and Sentry instrumentation declared in `package.json:1`. The data layer uses TypeORM view entities and an auto-migration routine to keep per-guild stats consistent, combining definitions like `src/db/karma-counts.ts:1` and the legacy migration in `src/db/auto-migrate.ts:1`.

### [webring](https://github.com/shepherdjerred/monorepo/tree/main/packages/webring) (2026-02-15)

Webring aggregates the latest items from user-defined RSS feeds, implemented in TypeScript with dependencies like rss-parser, remeda, sanitize-html, and truncate-html to fetch, transform, and sanitize entries. It supports an optional cached execution path that stores results on disk via zod-validated configuration, enabling per-source preview filters and shuffle controls before returning the final list.

### [fonts](https://github.com/shepherdjerred/monorepo/tree/main/packages/fonts) (2026-01-31)

Project provides a command-line workflow to patch Berkeley Mono TTF fonts with Nerd Fonts glyphs, rename them, and optionally install or archive the results. It is implemented as a Python 3.10 script that uses fontTools, fontforge, and the Nerd Fonts FontPatcher fetched with `curl`. The pipeline caches the patcher in `~/.cache/nerd-fonts-patcher`, enforces consistent style naming through a filename-to-style map, and supports post-processing steps like zipping and installing fonts.

### [resume](https://github.com/shepherdjerred/monorepo/tree/main/packages/resume) (2026-01-27)

Repository is a Bun-managed monorepo of personal tools and assets, including a LaTeX resume defined in `packages/resume/resume.tex` and other workspace packages registered in `package.json`. It uses Bun scripts with TypeScript and Tauri APIs declared in `package.json` for automation and desktop integrations. Building and deploying the resume is a manual step (the repo's CI pipeline was removed 2026-07).

### [birmel](https://github.com/shepherdjerred/monorepo/tree/main/packages/birmel) (2025-12-20)

This project implements the Birmel Discord bot that runs on the Bun runtime to automate guild interactions and AI-driven responses. It leverages concrete technologies like `discord.js`, `@ai-sdk/openai`, `@prisma/client`, `@opentelemetry/sdk-node`, and `@sentry/node` for messaging, language models, data access, telemetry, and monitoring. A notable architecture detail is the global Prisma client singleton that reuses the database connection across modules to keep the bot responsive.

### [eslint-config](https://github.com/shepherdjerred/monorepo/tree/main/packages/eslint-config) (2025-12-13)

@shepherdjerred/eslint-config provides reusable ESLint flat configurations that enforce accessibility, import discipline, and component best practices across React, React Native, and Astro codebases. The package integrates @eslint/js, typescript-eslint, eslint-plugin-astro, eslint-plugin-react, eslint-plugin-react-native, eslint-plugin-jsx-a11y, eslint-plugin-import, and the Bun-aware TypeScript resolver exposed in src/configs/\*.ts. Its modular configs in src/configs/base.ts, src/configs/imports.ts, src/configs/accessibility.ts, src/configs/react.ts, and src/configs/react-native.ts each return TSESLint.FlatConfig.ConfigArray instances so teams can compose rule sets with custom tsconfig roots, project service settings, and Bun-aware import resolution. The reactNativeConfig adds RN plugin rules, RN globals, disables DOM-specific React rules and Bun-specific rules, and allows PascalCase filenames.

<!--[[[end]]]-->

## Other Directories

| Directory                              | Description                                           |
| -------------------------------------- | ----------------------------------------------------- |
| [sandbox/poc/](sandbox/poc/)           | Proof-of-concept experiments                          |
| [sandbox/practice/](sandbox/practice/) | Learning projects - books, courses, coding challenges |
| [sandbox/archive/](sandbox/archive/)   | Archived projects - completed or superseded           |

## Development

```bash
bun install              # Install dependencies
bun run build            # Build all packages
bun run test             # Test all packages
bun run typecheck        # Typecheck all packages
```

See [CLAUDE.md](CLAUDE.md) for detailed development guidance.

---

## Updating READMEs

This README uses [cogapp](https://nedbatchelder.com/code/cog/) to auto-generate project listings.

```bash
uvx --from cogapp cog -r README.md sandbox/practice/README.md sandbox/archive/README.md
```

Summaries are cached in `_summary.md` files. Delete a summary to regenerate it.

These listings are also regenerated automatically every Monday by the
`readme-refresh-weekly` Temporal schedule (`packages/temporal`), which runs the
same `cog -r` and opens a PR if anything drifted.
