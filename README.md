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
                "--ask-for-approval",
                "never",
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
**19 active packages**

### [homelab](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab) (2026-02-15)

*No description available.*

### [scout-for-lol](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol) (2026-02-15)

*No description available.*

### [sjer.red](https://github.com/shepherdjerred/monorepo/tree/main/packages/sjer.red) (2026-02-15)

*No description available.*

### [castle-casters](https://github.com/shepherdjerred/monorepo/tree/main/packages/castle-casters) (2026-02-15)

*No description available.*

### [dotfiles](https://github.com/shepherdjerred/monorepo/tree/main/packages/dotfiles) (2026-02-15)

*No description available.*

### [discord-plays-pokemon](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-pokemon) (2026-02-15)

*No description available.*

### [better-skill-capped](https://github.com/shepherdjerred/monorepo/tree/main/packages/better-skill-capped) (2026-02-15)

*No description available.*

### [starlight-karma-bot](https://github.com/shepherdjerred/monorepo/tree/main/packages/starlight-karma-bot) (2026-02-15)

*No description available.*

### [astro-opengraph-images](https://github.com/shepherdjerred/monorepo/tree/main/packages/astro-opengraph-images) (2026-02-15)

*No description available.*

### [anki](https://github.com/shepherdjerred/monorepo/tree/main/packages/anki) (2026-02-15)

*No description available.*

### [macos-cross-compiler](https://github.com/shepherdjerred/monorepo/tree/main/packages/macos-cross-compiler) (2026-02-15)

*No description available.*

### [webring](https://github.com/shepherdjerred/monorepo/tree/main/packages/webring) (2026-02-15)

*No description available.*

### [fonts](https://github.com/shepherdjerred/monorepo/tree/main/packages/fonts) (2026-01-31)

*No description available.*

### [tools](https://github.com/shepherdjerred/monorepo/tree/main/packages/tools) (2026-01-31)

*No description available.*

### [resume](https://github.com/shepherdjerred/monorepo/tree/main/packages/resume) (2026-01-27)

*No description available.*

### [clauderon](https://github.com/shepherdjerred/monorepo/tree/main/packages/clauderon) (2026-01-01)

*No description available.*

### [bun-decompile](https://github.com/shepherdjerred/monorepo/tree/main/packages/bun-decompile) (2025-12-30)

*No description available.*

### [birmel](https://github.com/shepherdjerred/monorepo/tree/main/packages/birmel) (2025-12-20)

*No description available.*

### [eslint-config](https://github.com/shepherdjerred/monorepo/tree/main/packages/eslint-config) (2025-12-13)

*No description available.*

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
