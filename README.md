# monorepo

Personal monorepo for active projects, learning, and archived work.

## Packages

<!--[[[cog
import cog
import subprocess
import pathlib
import json
from datetime import datetime, timezone

MODEL = "gpt-4.1"
GITHUB_URL = "https://github.com/shepherdjerred/monorepo/tree/main/packages"

def gather_source_context(folder_path, max_chars=8000):
    """Gather context from source files when no README exists."""
    context_parts = []

    # Check package.json
    pkg_json = folder_path / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            context_parts.append(f"package.json: name={pkg.get('name')}, description={pkg.get('description')}, dependencies={list(pkg.get('dependencies', {}).keys())[:10]}")
        except: pass

    # Check Cargo.toml
    cargo_toml = folder_path / "Cargo.toml"
    if cargo_toml.exists():
        context_parts.append(f"Cargo.toml:\n{cargo_toml.read_text()[:1000]}")

    # Check pyproject.toml
    pyproject = folder_path / "pyproject.toml"
    if pyproject.exists():
        context_parts.append(f"pyproject.toml:\n{pyproject.read_text()[:1000]}")

    # Find main source files
    main_files = [
        "src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx",
        "index.ts", "index.tsx", "main.ts", "main.tsx",
        "src/main.rs", "src/lib.rs", "main.rs", "lib.rs",
        "src/index.js", "index.js", "main.js",
        "src/main.py", "main.py", "app.py", "__init__.py",
    ]

    for mf in main_files:
        fp = folder_path / mf
        if fp.exists():
            content = fp.read_text()[:2000]
            context_parts.append(f"{mf}:\n{content}")
            break

    # List directory structure
    try:
        files = [f.name for f in folder_path.iterdir() if not f.name.startswith('.')][:20]
        context_parts.append(f"Files: {', '.join(files)}")
    except: pass

    return "\n\n".join(context_parts)[:max_chars]

def generate_summary(content, prompt, summary_path):
    """Generate summary using LLM and cache it."""
    result = subprocess.run(
        ['uvx', '--from', 'llm', 'llm', '-m', MODEL, '-s', prompt],
        input=content, capture_output=True, text=True, timeout=120
    )
    if result.returncode == 0 and result.stdout.strip():
        description = result.stdout.strip()
        summary_path.write_text(description + '\n')
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
            prompt = "Based on these source files, summarize this project in 2-3 sentences. Focus on what it does and key technologies. No emoji."
            desc = generate_summary(context, prompt, summary_path)
            cog.outl(desc if desc else "*No description available.*")
        else:
            cog.outl("*No description available.*")
    cog.outl()
]]]-->
**7 active packages**

### [mux-site](https://github.com/shepherdjerred/monorepo/tree/main/packages/mux-site) (2026-01-04)

This project is a website built using Astro, leveraging the @astrojs/starlight theme for documentation and sharp for image processing. TypeScript is used for type safety during development. The source code and static files are organized under the src and public directories, respectively, while Astro's configuration and tooling manage site generation and build processes.

### [clauderon](https://github.com/shepherdjerred/monorepo/tree/main/packages/clauderon) (2026-01-01)

Clauderon is a Rust-based session management system tailored for AI coding agents, enabling users to create, manage, and interact with coding agent sessions via command line or a terminal user interface (TUI). It leverages asynchronous programming (Tokio), terminal management (ratatui, crossterm, pty-process), persistent storage (SQLx with SQLite), and structured command-line parsing (clap), providing extensible backend options (like zellij or Docker) for session orchestration. The system supports operations such as session creation, listing, attachment, archiving, and deletion, and includes a daemon mode with optional HTTP API services.

### [bun-decompile](https://github.com/shepherdjerred/monorepo/tree/main/packages/bun-decompile) (2025-12-30)

This project, bun-decompile, is a CLI tool designed to extract and de-minify source code from executables compiled with the Bun JavaScript runtime. It leverages AI models—accessed via providers like OpenAI or Anthropic—to reconstruct and de-minify obfuscated or minified JavaScript, providing options for batch processing, API concurrency, and result caching. Key technologies include Bun, Babel for parsing and transforming code, the Anthropic AI/SDK for LLM integration, and a command-line interface for flexible operation.

### [claude-plugin](https://github.com/shepherdjerred/monorepo/tree/main/packages/claude-plugin) (2025-12-23)

This project implements a system for managing and utilizing AI agents. It uses Python and likely leverages frameworks such as LangChain for orchestrating agent workflows. The agents can be configured for various tasks, enabling flexible and modular AI-powered solutions.

### [birmel](https://github.com/shepherdjerred/monorepo/tree/main/packages/birmel) (2025-12-20)

This project, @shepherdjerred/birmel, is a TypeScript-based application that integrates with Discord to provide AI-powered message handling features. It uses the Mastra framework for core logic and observability, connects to a database (via Prisma and libsql), and incorporates OpenAI services for AI interactions. The architecture emphasizes observability (with OpenTelemetry and Sentry), scheduled tasks, and modular components supporting Discord event handling, memory management, and a music player.

### [dagger-utils](https://github.com/shepherdjerred/monorepo/tree/main/packages/dagger-utils) (2025-12-13)

@shepherdjerred/dagger-utils is a TypeScript library providing reusable container builders and utilities for Dagger-based CI/CD pipelines. It offers optimized, cache-aware container factory functions for popular tools (such as Node, Bun, GitHub, and Cloudflare), as well as utilities for parallel execution and logging within pipeline workflows. Core technology includes Dagger, Zod for validation, and TypeScript for type safety.

### [eslint-config](https://github.com/shepherdjerred/monorepo/tree/main/packages/eslint-config) (2025-12-13)

@shepherdjerred/eslint-config is a comprehensive and modular ESLint configuration package tailored for TypeScript projects, offering extensible support for React, accessibility (jsx-a11y), Astro, and Bun-specific coding patterns. It incorporates a range of popular ESLint plugins—including @typescript-eslint, eslint-plugin-unicorn, eslint-plugin-import, eslint-plugin-react, and others—and provides both prebuilt composable configs and custom rule plugins to enforce consistent code quality and best practices. The project is written in TypeScript and designed for advanced customization and integration into modern JavaScript/TypeScript codebases.

<!--[[[end]]]-->

## Other Directories

| Directory | Description |
|-----------|-------------|
| [practice/](practice/) | Learning projects - books, courses, coding challenges |
| [archive/](archive/) | Archived projects - completed or superseded |

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
