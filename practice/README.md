# Practice

Learning projects and exercises - working through books, courses, and coding challenges.

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
GITHUB_URL = "https://github.com/shepherdjerred/monorepo/tree/main/practice"
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

practice_dir = pathlib.Path(cog.inFile).parent
subdirs_with_dates = []

for d in practice_dir.iterdir():
    if d.is_dir() and not d.name.startswith('.') and not d.name.startswith('_'):
        try:
            result = subprocess.run(
                ['git', 'log', '--diff-filter=A', '--follow', '--format=%aI', '--reverse', '--', d.name],
                capture_output=True, text=True, timeout=5, cwd=practice_dir
            )
            if result.returncode == 0 and result.stdout.strip():
                date_str = result.stdout.strip().split('\n')[0]
                commit_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                subdirs_with_dates.append((d.name, commit_date))
            else:
                subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))
        except Exception:
            subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))

cog.outl(f"## {len(subdirs_with_dates)} learning projects\n")
subdirs_with_dates.sort(key=lambda x: x[1], reverse=True)

for dirname, commit_date in subdirs_with_dates:
    folder_path = practice_dir / dirname
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
## 27 learning projects

### [game](https://github.com/shepherdjerred/monorepo/tree/main/practice/game) (2026-02-22)

This Rust project builds a 2D space shooter where player and enemy ships move and fire missiles inside defined world bounds. It runs on Bevy 0.8.1 with Rapier2D 0.17.0 for ECS-based rendering and physics, including sprite bundle assets and collider components. The architecture schedules gameplay logic on a fixed 1/60-second timestep and tags entities with bounds-tracking components to clamp movement and despawn objects that leave the arena.

### [hson](https://github.com/shepherdjerred/monorepo/tree/main/practice/hson) (2026-02-22)

*No description available.*

### [rust-grep](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-grep) (2026-02-22)

This project implements a grep-style command-line utility that scans files for lines containing a specified query. It is built in Rust (2018 edition) with only standard library components such as `std::env` and `std::fs`. Command-line parsing constructs a `Config` struct—including CASE_INSENSITIVE environment handling—that routes search operations through dedicated case-sensitive and case-insensitive functions.

### [programming-with-categories](https://github.com/shepherdjerred/monorepo/tree/main/practice/programming-with-categories) (2026-02-22)

This monorepo gathers personal projects for experimentation and archiving across languages such as TypeScript and Haskell, keeping active and historical work in one workspace. It uses Bun-managed workspaces defined in `package.json`, pulls in desktop-focused dependencies like `@tauri-apps/api`, and includes examples such as `practice/programming-with-categories/main.hs`. A notable capability is the custom Bun runner in `scripts/run-package-script.ts` that crawls each package’s manifest and executes shared build or test scripts across the entire workspace automatically.

### [leetcode](https://github.com/shepherdjerred/monorepo/tree/main/practice/leetcode) (2026-02-22)

This Maven-based Java 21 LeetCode practice module collects algorithmic solutions such as balancing shared expenses, generating count-and-say sequences, and composing target-matching arithmetic expressions in `src/main/java/sjer/red`. It leverages Java standard library constructs like `HashMap`, `PriorityQueue`, and recursive depth-first search, with `ExpressionAddOperators.solve` maintaining operand state to enumerate every valid expression that meets a target value.

### [rust-guessing-game](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-guessing-game) (2026-02-22)

This is a Rust command-line guessing game where the player guesses numbers between 0 and 20. It uses the Rust 2018 edition with the `rand` 0.8.3 crate and `std::io` to handle random target generation and user input. A notable detail is its use of `thread_rng().gen_range(0..21)` to cover the full range inclusively before comparing the player's guess to the target.

### [learn-you-a-haskell-exercises](https://github.com/shepherdjerred/monorepo/tree/main/practice/learn-you-a-haskell-exercises) (2026-02-22)

Learn You a Haskell Exercises is a Haskell Stack project that implements the book’s chapter exercises, providing concrete practice functions such as list utilities defined in `practice/learn-you-a-haskell-exercises/src/StartingOut.hs:1`. It builds with Stack against the Stackage LTS 18.0 snapshot and depends on `base` and `random`, with tests discovered by `hspec-discover` as configured in `practice/learn-you-a-haskell-exercises/package.yaml:21`-`38` and `practice/learn-you-a-haskell-exercises/test/Spec.hs:1`. The source tree mirrors the book’s structure—modules like `FunctorsApplicativeFunctorsAndMonoids.hs` and `AFistfulOfMonads.hs` encapsulate chapter-specific solutions for targeted study (`practice/learn-you-a-haskell-exercises/src/FunctorsApplicativeFunctorsAndMonoids.hs:1`, `practice/learn-you-a-haskell-exercises/src/AFistfulOfMonads.hs:1`).

### [rust-web-server](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-web-server) (2026-02-22)

This project implements a multithreaded Rust HTTP server that listens on 127.0.0.1:8080 and serves basic requests with hard-coded configuration. It relies on Rust 2018 with only the standard library (for example `std::net::TcpListener` and a custom `ThreadPool`) to parse requests and craft responses. Notably, it uses a manually built thread pool to dispatch incoming TCP connections across worker threads for concurrency.

### [Exercism](https://github.com/shepherdjerred/monorepo/tree/main/practice/Exercism) (2026-02-22)

*No description available.*

### [fastbook](https://github.com/shepherdjerred/monorepo/tree/main/practice/fastbook) (2026-02-22)

This project is a fork of fastai/fastbook that captures the maintainer’s annotated progression through each fast.ai deep learning lesson in chapter-aligned Jupyter notebooks. It runs the notebooks with Python using fastai, PyTorch, and related tooling defined in `environment.yml` and `requirements.txt`, and can spin up in Google Colab through the badge in `README.md`. The repository organizes reusable helpers in `utils.py` and offers localized guides (`README_es.md`, `README_id.md`, `README_zh.md`) alongside chapter notebooks like `09_tabular.ipynb` and `16_accel_sgd.ipynb`.

### [dns](https://github.com/shepherdjerred/monorepo/tree/main/practice/dns) (2026-02-22)

This Rust project models DNS protocol data structures and currently emits a greeting when run. It uses the Rust 2021 toolchain with the `packed_struct` crate to define bit-precise DNS headers, questions, and related fields. By deriving `PackedStruct` for nested types such as `Message` and `Header`, it enables big-endian serialization of DNS components without manual byte handling.

### [langchain](https://github.com/shepherdjerred/monorepo/tree/main/practice/langchain) (2026-02-22)

*No description available.*

### [go-wiki](https://github.com/shepherdjerred/monorepo/tree/main/practice/go-wiki) (2026-02-22)

This project implements a file-backed wiki web server that lets users view, edit, and save pages via HTTP routes. It is built in Go using the standard library packages `net/http`, `html/template`, and `regexp`, with templates under `html/` driving the UI. Pages persist as `.txt` files in `pages/`, and requests resolve page titles through regex-matched routes before rendering the appropriate template.

### [a2ui-poc](https://github.com/shepherdjerred/monorepo/tree/main/practice/a2ui-poc) (2026-02-22)

The project delivers an AI-powered knowledge exploration agent that emits structured A2UI protocol messages to drive interactive surfaces for user queries. It is built in TypeScript with Bun tooling and depends on `@ai-sdk/anthropic`, `ai`, `hono`, and `zod` for AI integration, routing, and schema handling. The `KnowledgeAgent` streams Anthropic output, strips Markdown fences, and parses newline-delimited JSON to yield UI updates using the A2UI message builders.

### [posit-academy](https://github.com/shepherdjerred/monorepo/tree/main/practice/posit-academy) (2026-02-22)

This project analyzes the 2020 R Community Survey, recreating milestone exercises that summarize and visualize respondent enjoyability scores, job categories, and related metrics. The codebase uses R Markdown with knitr plus tidyverse packages such as readr, dplyr, tidyr, and ggplot2 to load, transform, and plot the survey data. Extension reporting consolidates the weekly milestones into `extension_4.Rmd`, merging country-level metrics, paginated tables, and multiple visualization variants under a single html_document theme.

### [sicp](https://github.com/shepherdjerred/monorepo/tree/main/practice/sicp) (2026-02-22)

This monorepo centralizes the author’s active projects, learning experiments, and archived work under a shared Bun toolchain that exposes repository-wide build, test, and typecheck commands. It runs on Bun-managed TypeScript workspaces defined in `package.json:1`, integrating tooling such as Tauri APIs, Lefthook git hooks, and Dagger’s TypeScript SDK for automation. The repository relies on `scripts/run-package-script.ts:1` to traverse every package directory and execute the requested script while honoring the `SKIP_PACKAGES` exclusion list, giving the workspace a consistent orchestration layer.

### [rust-os](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-os) (2026-02-22)

This project is a bare-metal operating system written in Rust that targets x86_64 hardware. It relies on the `bootloader`, `x86_64`, `lazy_static`, `spin`, and `uart_16550` crates to configure the kernel runtime, interrupt tables, and serial console. The architecture includes a custom serial-backed test runner and a double-fault handler that uses a dedicated interrupt stack table for resilience.

### [mini-jam-98](https://github.com/shepherdjerred/monorepo/tree/main/practice/mini-jam-98) (2026-02-22)

mini-jam-98 is a Rust game project for the Mini Jam 98 Empty challenge, structured as a Bevy-powered application. It uses the Bevy 0.6.0 engine with dynamic linking and the rand 0.8.4 crate to drive its entity-component systems. The codebase defines granular components for enemies, health, inventory, and multi-directional movement states, enabling a modular ECS architecture for gameplay logic.

### [ostep-homework](https://github.com/shepherdjerred/monorepo/tree/main/practice/ostep-homework) (2026-02-22)

This repository hosts the OSTEP homework suite that reinforces operating systems concepts through chapter-aligned exercises and simulators. The exercises rely on Python scripts such as `cpu-intro/process-run.py` alongside x86 assembly snippets in `threads-locks/*.s` to model CPU scheduling, virtualization, and synchronization scenarios. Each simulator supports repeatable experimentation by letting learners generate unlimited problem instances via random seeds and solve them automatically with the `-c` flag.

### [jlox](https://github.com/shepherdjerred/monorepo/tree/main/practice/jlox) (2026-02-22)

This project implements the Lox programming language interpreter from Crafting Interpreters, providing both REPL and script execution entry points. It is built in Java with a Maven `pom.xml`, leveraging the `com.shepherdjerred.jlox` package and Java IO/NIO utilities to scan, parse, and evaluate source code. Expression classes in `src/main/java/com/shepherdjerred/jlox/Expr.java` use a visitor pattern consumed by `Interpreter` to centralize evaluation across the AST.

### [category-theory-for-programmers](https://github.com/shepherdjerred/monorepo/tree/main/practice/category-theory-for-programmers) (2026-02-22)

This monorepo consolidates active projects, experiments, and archived work under a single workspace with shared tooling. It runs on a Bun-managed TypeScript stack with repo-wide `package.json:1`, Lefthook hooks (`lefthook.yml:1`), a Dagger pipeline (`dagger.json:1`), and Tauri API dependencies that automate builds and desktop integrations. A notable capability is the automation script at `scripts/run-package-script.ts:1`, which enumerates packages and executes targeted scripts across the workspace while honoring skip lists for selective execution.

### [advent-of-code](https://github.com/shepherdjerred/monorepo/tree/main/practice/advent-of-code) (2026-02-22)

This personal monorepo consolidates active projects such as the `clauderon` session manager for AI coding agents, spanning tooling, docs, and archived work (`README.md:1`, `packages/clauderon/Cargo.toml:1`). It uses a Bun-managed TypeScript workspace with shared scripts and Tauri integrations alongside Rust crates that pull in Tokio, Axum, SQLx, Ratatui, WebAuthn, and gRPC support to deliver async services, terminal UIs, and desktop capabilities (`package.json:1`, `packages/clauderon/Cargo.toml:13`). A notable architecture detail is the repository-wide `scripts/run-package-script.ts` runner that orchestrates build, test, lint, and typecheck commands across every package directory to keep the multi-package structure consistent (`scripts/run-package-script.ts:1`).

### [bevy-experiment](https://github.com/shepherdjerred/monorepo/tree/main/practice/bevy-experiment) (2026-02-22)

bevy-experiment renders a 2D tile-based scene and controllable sprite using the Bevy game engine. It uses Rust with Bevy 0.4, the bevy_tiled_prototype tiled-map plugin, and Bevy diagnostic plugins for frame-time reporting. Startup systems load the TMX world and sprite assets while runtime systems handle keyboard-driven character motion and zoomable camera control.

### [diy-react](https://github.com/shepherdjerred/monorepo/tree/main/practice/diy-react) (2026-02-22)

This personal monorepo aggregates active packages, learning projects, and archived work into one workspace dedicated to ongoing experiments and tooling (`README.md:1`). It standardizes development with a Bun-managed TypeScript toolchain, using commands like `bun install`, `bun run build`, `bun run test`, and `bun run typecheck` to manage dependencies, builds, and quality gates (`README.md:56`). The `scripts/run-package-script.ts` automation enumerates every package beneath `packages/*` to execute requested scripts while honoring skip lists, giving the repo a consistent, centralized way to run tasks across the workspace (`README.md:34`).

### [vscode-extension](https://github.com/shepherdjerred/monorepo/tree/main/practice/vscode-extension) (2026-02-22)

This project is a VS Code extension named test that activates to expose a `test.helloWorld` command which greets the user with an information message (`src/extension.ts`). It is implemented in TypeScript on top of the VS Code extensibility API with build tooling managed through the esbuild-based pipeline configured in `esbuild.js` and `tsconfig.json`. The extension architecture registers the command during activation and disposes it via `context.subscriptions`, ensuring lifecycle cleanup within the VS Code host.

### [maze-game](https://github.com/shepherdjerred/monorepo/tree/main/practice/maze-game) (2026-02-22)

Maze is a console-based arcade game where you control an @ character with WASD to collect dots while evading ghosts. The codebase is a Java 8 Maven project that uses JLine for terminal rendering and Apache Commons Lang utilities. Its gameplay engine randomly instantiates MapObject subclasses for barriers, ghosts, and the player so each map and ghost configuration differs between runs.

### [claude-web](https://github.com/shepherdjerred/monorepo/tree/main/practice/claude-web) (2026-02-22)

This project runs a Claude web service that authenticates via GitHub and brokers agent sessions by streaming Docker container output to browser clients. The backend is written in TypeScript with Bun WebSockets, the Hono framework, Prisma, dockerode, jose, ws, and zod. An AgentProxy class relays NDJSON logs from container streams to WebSocket clients while token helpers XOR-encrypt stored GitHub access tokens with the JWT secret.

<!--[[[end]]]-->
