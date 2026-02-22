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
**21 active packages**

### [scout-for-lol](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol) (2026-02-22)

Scout for League of Legends is a Discord bot that tracks your friends’ matches and delivers post-game notifications with rich stat reports directly into your server. The codebase uses React, the Tauri app framework, Zod validation, ffmpeg-static, and both OpenAI and Google Generative AI SDKs (`package.json`). It runs configurable competitions, supports multi-region player tracking, and generates full arena-mode reports for all teams with augment and placement data.

### [homelab](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab) (2026-02-22)

Homelab provisions and manages a Kubernetes-driven personal infrastructure cluster named `torvalds`, delivering fully automated deployments and backups through ArgoCD orchestration. The repo uses TypeScript with cdk8s built and bundled by Bun, paired with Talos control-plane scripts and generated Helm chart typings under `src/cdk8s/generated/helm`. It enforces an ArgoCD app-of-apps architecture with dependency pinning and automated updates that keep Docker images, Helm charts, and Bun packages current.

### [anki](https://github.com/shepherdjerred/monorepo/tree/main/packages/anki) (2026-02-22)

This package automates turning Markdown study notes (`book_high_performance_web_applications.md`, `book_ostep.md`, `bytes.md`, `interview.md`) into Anki decks by invoking the mdanki CLI to emit `.apkg` files. The `generate.sh` workflow relies on Node.js tooling (`npx`, `mdanki`, `sql.js`) plus a shared `settings.json` template that defines the card HTML and CSS, and it swaps in the `sql-memory-growth.js` build of sql.js before running the conversions so every deck is generated with the memory-growth WebAssembly runtime.

### [bun-decompile](https://github.com/shepherdjerred/monorepo/tree/main/packages/bun-decompile) (2026-02-22)

bun-decompile extracts and de-minifies Bun-compiled executables, retrieving their bundled module graph and sourcemaps to recover original sources. It targets the Bun runtime with TypeScript tooling and leans on Babel, OpenAI, and Anthropic SDKs defined in `package.json`. Its AI de-minification pipeline combines call-graph analysis with Babel scope renaming to guarantee the renamed code remains functionally equivalent.

### [macos-cross-compiler](https://github.com/shepherdjerred/monorepo/tree/main/packages/macos-cross-compiler) (2026-02-22)

This project packages a macOS cross-compilation toolchain so Linux hosts can build C, C++, Fortran, and Rust binaries targeting macOS, ideal for CI pipelines. It relies on a Docker image configured with osxcross-based GCC, Clang, GFortran, and Zig (configurable via `mise.toml`) alongside bundled macOS SDK headers and libraries. The image mounts user source directories into `/workspace` and exposes architecture-specific targets like `aarch64-apple-darwin24-*`, enabling reproducible builds for arm64 and x86_64 macOS binaries.

### [webring](https://github.com/shepherdjerred/monorepo/tree/main/packages/webring) (2026-02-22)

Webring aggregates the latest items from user-defined RSS feeds, implemented in TypeScript with dependencies like rss-parser, remeda, sanitize-html, and truncate-html to fetch, transform, and sanitize entries. It supports an optional cached execution path that stores results on disk via zod-validated configuration, enabling per-source preview filters and shuffle controls before returning the final list.

### [sjer.red](https://github.com/shepherdjerred/monorepo/tree/main/packages/sjer.red) (2026-02-22)

This repo powers the sjer.red personal site, delivering blog posts, curated bookmarks, and other content through Astro-driven static pages. It runs on Astro with plugins like @astrojs/mdx, @astrojs/rss, Tailwind CSS, and Node-based utilities such as `src/bookmarks/bookmarks.ts` that use jsdom and Zod to automate bookmark ingestion, giving the site an automated link curation pipeline.

### [discord-plays-pokemon](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-pokemon) (2026-02-22)

Discord Plays Pokémon turns a Discord server into a cooperative controller for a Game Boy Advance emulator, letting the community drive Pokémon (or any supported ROM) together. The Bun-powered TypeScript monorepo includes an Express + Discord.js backend and a React/Vite + Tailwind frontend that exchange commands through Socket.IO with shared logic in @discord-plays-pokemon/common. A dedicated web interface streams keypresses straight to the emulator so players can bypass chat latency while still staying coordinated with Discord inputs.

### [astro-opengraph-images](https://github.com/shepherdjerred/monorepo/tree/main/packages/astro-opengraph-images) (2026-02-22)

This project ships an Astro integration that generates Open Graph images for every page in a static Astro build. It is written in TypeScript and relies on React-based presets powered by Satori and the @resvg/resvg-js renderer. During the astro:build:done hook it sanitizes HTML with jsdom, extracts Open Graph metadata, and renders customizable presets that cover Astro content collections.

### [castle-casters](https://github.com/shepherdjerred/monorepo/tree/main/packages/castle-casters) (2026-02-22)

Castle Casters is a cross-platform Quoridor adaptation with a medieval fantasy theme that runs its main loop through `GameEngine` and an application-wide `EventBus`. It is built in Java 21 using LWJGL (OpenGL 4.1, OpenAL, GLFW, stb), Netty 4, Jenetics, GSON, and Lombok, and it features an alpha-beta search AI implemented with the MiniMaxAlgorithm to choose optimal turns.

### [birmel](https://github.com/shepherdjerred/monorepo/tree/main/packages/birmel) (2026-02-22)

This project implements the Birmel Discord bot that runs on the Bun runtime to automate guild interactions and AI-driven responses. It leverages concrete technologies like `discord.js`, `@ai-sdk/openai`, `@prisma/client`, `@opentelemetry/sdk-node`, and `@sentry/node` for messaging, language models, data access, telemetry, and monitoring. A notable architecture detail is the global Prisma client singleton that reuses the database connection across modules to keep the bot responsive.

### [monarch](https://github.com/shepherdjerred/monorepo/tree/main/packages/monarch) (2026-02-22)

Monarch is an AI-powered pipeline that categorizes Monarch Money transactions by orchestrating Claude-driven classification, Amazon order reconciliation, Venmo note parsing, and Bilt rent splitting. The Bun-based TypeScript CLI leans on @anthropic-ai/sdk, playwright scraping, and zod validation to fetch transactions, scrape Amazon order history, and batch requests. Its modular architecture routes merchant-specific handlers—like Amazon cache-aware matching and Venmo CSV ingestion—into a unified apply flow that can run interactively or automatically.

### [resume](https://github.com/shepherdjerred/monorepo/tree/main/packages/resume) (2026-02-22)

Repository is a Bun-managed monorepo of personal tools and assets, including a LaTeX resume defined in `packages/resume/resume.tex` and other workspace packages registered in `package.json`. It uses Bun scripts with TypeScript, Lefthook, Dagger’s TypeScript SDK, and Tauri APIs declared in `package.json` for automation and desktop integrations. Build automation is centralized through Dagger configuration in `dagger.json`, enabling the shared scripts to orchestrate tasks across every workspace.

### [dotfiles](https://github.com/shepherdjerred/monorepo/tree/main/packages/dotfiles) (2026-02-22)

This repository is a personal monorepo aggregating active projects, learning experiments, and archived work under a shared workspace `README.md:3`. It uses a Bun-powered TypeScript setup with declared workspaces, Lefthook git hooks, Dagger tooling, and Tauri API dependencies managed through `package.json:1`. A notable capability is the Bun automation script `scripts/run-package-script.ts:1`, which discovers every package under `packages/*` and executes a requested script across them while honoring skip lists for selective runs.

### [eslint-config](https://github.com/shepherdjerred/monorepo/tree/main/packages/eslint-config) (2026-02-22)

@shepherdjerred/eslint-config provides reusable ESLint flat configurations that enforce accessibility, import discipline, and component best practices across React and Astro codebases. The package integrates @eslint/js, typescript-eslint, eslint-plugin-astro, eslint-plugin-react, eslint-plugin-jsx-a11y, eslint-plugin-import, and the Bun-aware TypeScript resolver exposed in src/configs/*.ts. Its modular configs in src/configs/base.ts, src/configs/imports.ts, src/configs/accessibility.ts, and src/configs/react.ts each return TSESLint.FlatConfig.ConfigArray instances so teams can compose rule sets with custom tsconfig roots, project service settings, and Bun-aware import resolution.

### [fonts](https://github.com/shepherdjerred/monorepo/tree/main/packages/fonts) (2026-02-22)

Project provides a command-line workflow to patch Berkeley Mono TTF fonts with Nerd Fonts glyphs, rename them, and optionally install or archive the results. It is implemented as a Python 3.10 script that uses fontTools, fontforge, and the Nerd Fonts FontPatcher fetched with `curl`. The pipeline caches the patcher in `~/.cache/nerd-fonts-patcher`, enforces consistent style naming through a filename-to-style map, and supports post-processing steps like zipping and installing fonts.

### [better-skill-capped](https://github.com/shepherdjerred/monorepo/tree/main/packages/better-skill-capped) (2026-02-22)

Better Skill Capped is a React web app that rebuilds Skill Capped’s catalog into a richer interface driven by the service’s embedded video manifest. It is built with TypeScript, Vite, Bulma styling, Font Awesome icons, Fuse.js search utilities, and Sentry monitoring. The UI persists bookmarks and viewing status through localStorage-backed datastores, giving users personalized tracking alongside the enhanced catalog view.

### [starlight-karma-bot](https://github.com/shepherdjerred/monorepo/tree/main/packages/starlight-karma-bot) (2026-02-22)

Starlight Karma Bot is a Discord bot that manages karma points, leaderboards, and history commands for servers. It runs on Bun with discord.js v14, TypeORM backed by SQLite, dotenv/env-var configuration helpers, and Sentry instrumentation declared in `package.json:1`. The data layer uses TypeORM view entities and an auto-migration routine to keep per-guild stats consistent, combining definitions like `src/db/karma-counts.ts:1` and the legacy migration in `src/db/auto-migrate.ts:1`.

### [clauderon](https://github.com/shepherdjerred/monorepo/tree/main/packages/clauderon) (2026-02-22)

Clauderon is a Rust-based session manager that runs isolated Claude Code or Codex sessions inside Docker containers or Kubernetes pods for secure AI development workflows. It is built with the Tokio async runtime, Clap for CLI parsing, Ratatui and Crossterm for terminal UIs, SQLx for SQLite persistence, and integrates Sentry-powered tracing to monitor errors. Claude, Codex, and Gemini agents share a CommonAgentLogic core in `src/agents` to keep their state detection and command orchestration consistent across the platform.

### [tools](https://github.com/shepherdjerred/monorepo/tree/main/packages/tools) (2026-02-22)

@shepherdjerred/tools is a TypeScript CLI that fetches and formats operational data from Bugsink, PagerDuty, and GitHub to streamline incident response workflows. The codebase runs on the Node.js toolchain defined in package.json, compiles TypeScript sources, and brings in the zod validation library. Command modules in src/commands—such as pr/health.ts—share formatter utilities to deliver modular features like PR health checks that bundle merge-conflict detection with CI status aggregation.

### [docs](https://github.com/shepherdjerred/monorepo/tree/main/packages/docs) (2026-02-22)

This monorepo centralizes active projects, learning efforts, and archived work under a Bun workspaces layout that standardizes commands across packages (`README.md:3`, `packages/docs/architecture/monorepo-structure.md:3`). Core tooling spans Bun scripts, TypeScript, Dagger, Tauri modules, and infrastructure stacks like cdk8s and OpenTofu, all declared in the root workspace manifest and architecture docs (`package.json:5`, `package.json:15`, `package.json:26`, `package.json:31`, `packages/docs/architecture/monorepo-structure.md:27`). Its Dagger-based CI pipeline splits Tier 0 checks into distinct Buildkite steps for granular visibility and shared caching on the serialized engine (`packages/docs/architecture/ci-pipeline.md:3`, `packages/docs/plans/buildkite.md:5`, `packages/docs/plans/buildkite.md:57`).

<!--[[[end]]]-->

## Other Directories

| Directory              | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| [practice/](practice/) | Learning projects - books, courses, coding challenges |
| [archive/](archive/)   | Archived projects - completed or superseded           |

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
uvx --from cogapp cog -r README.md practice/README.md archive/README.md
```

Summaries are cached in `_summary.md` files. Delete a summary to regenerate it.
