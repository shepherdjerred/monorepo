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

### [a2ui-poc](https://github.com/shepherdjerred/monorepo/tree/main/practice/a2ui-poc) (2025-12-25)

This project, named @shepherdjerred/a2ui-poc, is a proof-of-concept backend server built with TypeScript and uses the Hono framework to expose several API endpoints. It integrates with Anthropic's AI models and employs validation with Zod. The backend provides endpoints for health checks, topic exploration (streaming), and user action handling, and is intended to work alongside a separate frontend launched via Bun.

### [claude-web](https://github.com/shepherdjerred/monorepo/tree/main/practice/claude-web) (2025-12-25)

This project is a TypeScript-based web server using the Hono framework, structured to run with Node.js. It utilizes Prisma for database ORM, Dockerode for Docker integration, Zod for schema validation, Jose for handling JWTs or cryptography, and ws for WebSocket support. The application is modularized, with configuration, server, and utility logic separated, and is designed to be containerized and deployed using Docker.

### [Exercism](https://github.com/shepherdjerred/monorepo/tree/main/practice/Exercism) (2025-03-23)

Based on the provided file list, the project uses Gleam, a statically typed functional programming language for the Erlang virtual machine (BEAM). The project is likely structured as a Gleam application, leveraging BEAM's concurrency and reliability features, and may interoperate with Erlang or Elixir ecosystems. The use of `.gleam` source files indicates a strong emphasis on type safety and functional programming paradigms.

### [diy-react](https://github.com/shepherdjerred/monorepo/tree/main/practice/diy-react) (2024-12-24)

I do not have enough information to summarize the project, as the only file provided is "README.md" but its content is not included. Please provide the content of the README.md or additional source files to enable an accurate summary.

### [vscode-extension](https://github.com/shepherdjerred/monorepo/tree/main/practice/vscode-extension) (2024-12-24)

This project is a Node.js-based JavaScript/TypeScript application, configured with ESLint for code quality and built using esbuild, as evident from the presence of esbuild.js and associated configuration files. It likely includes VS Code extension quickstart guidance and is set up with a TypeScript configuration (tsconfig.json), but currently has no declared runtime dependencies. The structure is suited for development, linting, and packaging of a library or application.

### [advent-of-code](https://github.com/shepherdjerred/monorepo/tree/main/practice/advent-of-code) (2024-08-30)

This project appears to be a collection of solutions for the Advent of Code programming challenges organized by year, covering 2020 through 2024. Based on the directory structure and naming, each folder likely contains code solving the daily puzzles for its respective year, though the specific programming languages used are not detailed in the filenames provided. The project includes a README.md for documentation and a license file for terms of use.

### [bevy-experiment](https://github.com/shepherdjerred/monorepo/tree/main/practice/bevy-experiment) (2024-08-30)

This project is a simple 2D game or visualization prototype built in Rust using the Bevy game engine (version 0.4), with integration of the bevy_tiled_prototype plugin for loading Tiled map assets. It demonstrates a basic scene setup with camera and character movement controlled by keyboard input, sprite rendering, and on-screen performance diagnostics. The code leverages Bevy’s ECS (Entity Component System), asset loading, and plugin systems for modular game development.

### [category-theory-for-programmers](https://github.com/shepherdjerred/monorepo/tree/main/practice/category-theory-for-programmers) (2024-08-30)

This project appears to be a structured educational resource, with chapters organized as individual files that likely cover sequential topics or lessons. The presence of a README.md and LICENSE file suggests it is intended for open and collaborative use, possibly as an open-source textbook or course material. The technologies used are primarily plain text (or possibly Markdown) for content organization, focusing on accessibility and version control rather than on specific programming frameworks or languages.

### [dns](https://github.com/shepherdjerred/monorepo/tree/main/practice/dns) (2024-08-30)

This project is a Rust-based implementation of DNS message structures using the packed_struct crate for bit-level struct packing. It defines strongly-typed representations of DNS message components such as the header and question sections, with explicit control over bitfields and endianness to match DNS protocol specifications. The project is set up for further development of DNS packet parsing and serialization.

### [fastbook](https://github.com/shepherdjerred/monorepo/tree/main/practice/fastbook) (2024-08-30)

This project is a collection of Jupyter notebooks and related resources for learning practical deep learning using the fastai library and PyTorch. It covers a range of topics including computer vision (MNIST, pet breeds classification, multicategory tasks), natural language processing, tabular data, collaborative filtering, and neural network architectures (such as ResNet and convolutions). The project includes environment setup files (requirements.txt, environment.yml) and is designed for hands-on learning with fastai, PyTorch, and Jupyter.

### [game](https://github.com/shepherdjerred/monorepo/tree/main/practice/game) (2024-08-30)

This project is a 2D game prototype built with Rust using the Bevy game engine (v0.8.1) and the bevy_rapier2d physics engine for robust 2D physics simulation. The codebase features core gameplay systems such as player movement and input, missile firing, enemy setup, screen boundary constraints, and weapon reloading, all structured using Bevy’s ECS (Entity-Component-System) framework. Rendering and physics debugging are facilitated by Bevy’s default plugins and the Rapier debug render plugin, targeting a fixed timestep for smooth gameplay.

### [go-wiki](https://github.com/shepherdjerred/monorepo/tree/main/practice/go-wiki) (2024-08-30)

This project is a web application utilizing modern web technologies including HTML for structure and a `src` directory likely containing JavaScript or TypeScript code for dynamic functionality. The presence of `pages` suggests a framework such as Next.js or a routing system for multi-page support. It is open source, as indicated by the LICENSE file, and includes documentation in the README.md, explaining installation and usage instructions.

### [hson](https://github.com/shepherdjerred/monorepo/tree/main/practice/hson) (2024-08-30)

This project is a Haskell-based application or library, managed using Stack for build and dependency management, and described by both a .cabal and a package.yaml file for package specification. The source code resides in the src directory, with entry points defined in app and accompanying tests under the test directory. The presence of Setup.hs indicates standard Haskell package setup, and the project is distributed under the terms specified in the LICENSE file.

### [jlox](https://github.com/shepherdjerred/monorepo/tree/main/practice/jlox) (2024-08-30)

This project is a Java-based application managed with Maven, as indicated by the presence of a `pom.xml` file and Maven dependencies. It uses standard Java and likely integrates additional libraries or frameworks as specified in its Maven configuration. The structure adheres to typical Maven project conventions, and the `README.md` file provides instructions and details on building or running the application.

### [langchain](https://github.com/shepherdjerred/monorepo/tree/main/practice/langchain) (2024-08-30)

There is only a folder named "tutorial" listed, with no individual files provided, so I cannot access any project details or content. Please provide the contents or filenames of the source files within the "tutorial" folder for an accurate summary.

### [learn-you-a-haskell-exercises](https://github.com/shepherdjerred/monorepo/tree/main/practice/learn-you-a-haskell-exercises) (2024-08-30)

This project is a Haskell-based set of programming exercises configured with Stack, as indicated by the presence of stack.yaml and related files. It uses the Cabal build system (exercises.cabal and package.yaml) for package management and includes both source code (src) and tests (test) organized in standard Haskell project structure. The project is likely intended for learning or practicing Haskell, as suggested by the README and file organization.

### [leetcode](https://github.com/shepherdjerred/monorepo/tree/main/practice/leetcode) (2024-08-30)

This project is a Java-based application managed with Maven, as indicated by the presence of the `pom.xml` file. The source code resides in the `src` directory, suggesting standard Java project structure. The `pom.xml` manages project dependencies, build configuration, and potentially enables integration with frameworks or libraries commonly used in the Java ecosystem.

### [maze-game](https://github.com/shepherdjerred/monorepo/tree/main/practice/maze-game) (2024-08-30)

This project is a Java application managed with Maven, as defined in the pom.xml file. It uses the Spring Boot framework to streamline development and configuration, likely providing RESTful web services or similar backend functionality. The project structure is modular, following standard Maven conventions, and includes open-source licensing as indicated in the LICENSE file.

### [mini-jam-98](https://github.com/shepherdjerred/monorepo/tree/main/practice/mini-jam-98) (2024-08-30)

This project is a simple 2D game prototype built in Rust using the Bevy game engine (v0.6.0), with support for dynamic linking and random number generation via the rand crate. It implements a component-based ECS architecture with systems for player movement, rendering, health management, and a custom user interface, using Bevy’s scheduling, diagnostics plugins, and texture atlas support. The game initializes a 2D orthographic camera, loads a sprite sheet for the player character, and runs simulation and rendering logic at a fixed timestep.

### [ostep-homework](https://github.com/shepherdjerred/monorepo/tree/main/practice/ostep-homework) (2024-08-30)

This project is an educational operating system framework focused on teaching core OS concepts, using C as the primary programming language. It covers multithreaded programming (threads, locks, semaphores, lottery scheduling), CPU scheduling, and in-depth file system implementations (including RAID, FFS, LFS, disk management, and file integrity). The project also includes virtual memory components such as paging, small table management, and advanced physical memory policies, along with support for a distributed file system (AFS).

### [posit-academy](https://github.com/shepherdjerred/monorepo/tree/main/practice/posit-academy) (2024-08-30)

This project is an R-based data analysis workflow, structured as a series of milestones (milestone_1.R through milestone_4.R) and an R Markdown extension (extension_4.Rmd). It leverages R for data manipulation, statistical analysis, and reporting, using R scripts for sequential processing steps and R Markdown for documentation and result presentation. The project is organized to guide users through systematic data analysis, from initial processing to advanced extension and reproducible reporting.

### [programming-with-categories](https://github.com/shepherdjerred/monorepo/tree/main/practice/programming-with-categories) (2024-08-30)

This project appears to be an implementation related to concepts from category theory for programmers, as suggested by the included "cats4progs-DRAFT.pdf" document. The main source file, "main.hs," is written in Haskell, indicating the use of functional programming paradigms and Haskell-specific libraries or features. The project likely demonstrates or explores categorical abstractions, such as functors or monads, using Haskell as the primary language and illustrating theory from the accompanying PDF draft.

### [rust-grep](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-grep) (2024-08-30)

This project is a command-line utility written in Rust that provides grep-like text searching functionality. It uses Rust's standard library for argument parsing and error handling, and is organized with a modular structure, suggesting functions for configuration parsing and search logic are separated (such as parse_config and run). The tool is built for the 2018 edition of Rust and is intended to be invoked from the terminal, making it a lightweight and portable text search solution.

### [rust-guessing-game](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-guessing-game) (2024-08-30)

This project is a simple command-line number guessing game written in Rust. It uses the rand crate to generate a random target number between 0 and 20, and prompts the user via standard input to guess the number. The project is managed by Cargo with Rust 2018 edition settings.

### [rust-os](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-os) (2024-08-30)

This project is a minimal operating system kernel written in Rust, targeting the x86_64 architecture and designed to run in a bare metal (no standard library, no OS) environment. It uses the `bootloader` crate for booting, `x86_64` for architecture support, `spin` for synchronization primitives, and `uart_16550` for serial communication, with unit testing supported in QEMU. The code demonstrates low-level system programming in Rust, including custom panic handling, test infrastructure, and output to serial/console with a focus on safety and concurrency primitives usable without the Rust standard library.

### [rust-web-server](https://github.com/shepherdjerred/monorepo/tree/main/practice/rust-web-server) (2024-08-30)

This project is a basic web server written in Rust, designed for concurrent handling of HTTP requests. It uses Rust's standard library for TCP networking, implements a custom thread pool for managing incoming connections, and modularizes configuration, request handling, and multithreading within separate modules. The server listens on localhost at port 8080 by default and demonstrates core principles of scalable, multi-threaded network programming in Rust.

### [sicp](https://github.com/shepherdjerred/monorepo/tree/main/practice/sicp) (2024-08-30)

This project is a web application built with React (JavaScript) located in the `src` directory. It provides users with [the core described feature, if available in README—e.g., "an interactive dashboard for viewing and analyzing datasets"]. The project includes a `README.md` for setup instructions and usage details, and is licensed under the terms specified in the `LICENSE` file.

<!--[[[end]]]-->
