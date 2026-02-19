# Archive

Archived personal projects - completed, abandoned, or superseded.

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
GITHUB_URL = "https://github.com/shepherdjerred/monorepo/tree/main/archive"
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

archive_dir = pathlib.Path(cog.inFile).parent
subdirs_with_dates = []

for d in archive_dir.iterdir():
    if d.is_dir() and not d.name.startswith('.') and not d.name.startswith('_'):
        try:
            result = subprocess.run(
                ['git', 'log', '--diff-filter=A', '--follow', '--format=%aI', '--reverse', '--', d.name],
                capture_output=True, text=True, timeout=5, cwd=archive_dir
            )
            if result.returncode == 0 and result.stdout.strip():
                date_str = result.stdout.strip().split('\n')[0]
                commit_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                subdirs_with_dates.append((d.name, commit_date))
            else:
                subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))
        except Exception:
            subdirs_with_dates.append((d.name, datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc)))

cog.outl(f"## {len(subdirs_with_dates)} archived projects\n")
subdirs_with_dates.sort(key=lambda x: x[1], reverse=True)

for dirname, commit_date in subdirs_with_dates:
    folder_path = archive_dir / dirname
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
## 41 archived projects

### [aws-docker-cdk](https://github.com/shepherdjerred/monorepo/tree/main/archive/aws-docker-cdk) (2026-02-19)

*No description available.*

### [skill-capped-discord-bot](https://github.com/shepherdjerred/monorepo/tree/main/archive/skill-capped-discord-bot) (2026-02-19)

*No description available.*

### [ansible-playbook](https://github.com/shepherdjerred/monorepo/tree/main/archive/ansible-playbook) (2026-02-19)

*No description available.*

### [siphon](https://github.com/shepherdjerred/monorepo/tree/main/archive/siphon) (2026-02-19)

*No description available.*

### [harding-christmas](https://github.com/shepherdjerred/monorepo/tree/main/archive/harding-christmas) (2026-02-19)

*No description available.*

### [gpt-2](https://github.com/shepherdjerred/monorepo/tree/main/archive/gpt-2) (2026-02-19)

*No description available.*

### [discord](https://github.com/shepherdjerred/monorepo/tree/main/archive/discord) (2026-02-19)

*No description available.*

### [file-matcher](https://github.com/shepherdjerred/monorepo/tree/main/archive/file-matcher) (2026-02-19)

*No description available.*

### [nutrition](https://github.com/shepherdjerred/monorepo/tree/main/archive/nutrition) (2026-02-19)

*No description available.*

### [is-quarantine-over-yet](https://github.com/shepherdjerred/monorepo/tree/main/archive/is-quarantine-over-yet) (2026-02-19)

*No description available.*

### [jukebox](https://github.com/shepherdjerred/monorepo/tree/main/archive/jukebox) (2026-02-19)

*No description available.*

### [herd](https://github.com/shepherdjerred/monorepo/tree/main/archive/herd) (2026-02-19)

*No description available.*

### [docblocs](https://github.com/shepherdjerred/monorepo/tree/main/archive/docblocs) (2026-02-19)

*No description available.*

### [time-off](https://github.com/shepherdjerred/monorepo/tree/main/archive/time-off) (2026-02-19)

*No description available.*

### [hue-saber](https://github.com/shepherdjerred/monorepo/tree/main/archive/hue-saber) (2026-02-19)

*No description available.*

### [ec2-instance-restart](https://github.com/shepherdjerred/monorepo/tree/main/archive/ec2-instance-restart) (2026-02-19)

*No description available.*

### [eng211-research-paper](https://github.com/shepherdjerred/monorepo/tree/main/archive/eng211-research-paper) (2026-02-19)

*No description available.*

### [monarch-money](https://github.com/shepherdjerred/monorepo/tree/main/archive/monarch-money) (2026-02-19)

*No description available.*

### [ec2-instance-restart-frontend](https://github.com/shepherdjerred/monorepo/tree/main/archive/ec2-instance-restart-frontend) (2026-02-19)

*No description available.*

### [rsi-hackathon-2016](https://github.com/shepherdjerred/monorepo/tree/main/archive/rsi-hackathon-2016) (2026-02-19)

*No description available.*

### [west-elm-shipment-notifier](https://github.com/shepherdjerred/monorepo/tree/main/archive/west-elm-shipment-notifier) (2026-02-19)

*No description available.*

### [frankie-and-jos-flavor-scraper](https://github.com/shepherdjerred/monorepo/tree/main/archive/frankie-and-jos-flavor-scraper) (2026-02-19)

*No description available.*

### [raspastat](https://github.com/shepherdjerred/monorepo/tree/main/archive/raspastat) (2026-02-19)

*No description available.*

### [cashly](https://github.com/shepherdjerred/monorepo/tree/main/archive/cashly) (2026-02-19)

*No description available.*

### [shepherdjerred-impostor](https://github.com/shepherdjerred/monorepo/tree/main/archive/shepherdjerred-impostor) (2026-02-19)

*No description available.*

### [ts-mc](https://github.com/shepherdjerred/monorepo/tree/main/archive/ts-mc) (2026-02-19)

*No description available.*

### [lambda-sagemaker-endpoint](https://github.com/shepherdjerred/monorepo/tree/main/archive/lambda-sagemaker-endpoint) (2026-02-19)

*No description available.*

### [usher](https://github.com/shepherdjerred/monorepo/tree/main/archive/usher) (2026-02-19)

*No description available.*

### [type-challenges](https://github.com/shepherdjerred/monorepo/tree/main/archive/type-challenges) (2026-02-19)

*No description available.*

### [funsheet](https://github.com/shepherdjerred/monorepo/tree/main/archive/funsheet) (2026-02-19)

*No description available.*

### [devcontainers-features](https://github.com/shepherdjerred/monorepo/tree/main/archive/devcontainers-features) (2026-02-19)

*No description available.*

### [the-button](https://github.com/shepherdjerred/monorepo/tree/main/archive/the-button) (2026-02-19)

*No description available.*

### [list-easel](https://github.com/shepherdjerred/monorepo/tree/main/archive/list-easel) (2026-02-19)

*No description available.*

### [gpt-2-simple-sagemaker-container](https://github.com/shepherdjerred/monorepo/tree/main/archive/gpt-2-simple-sagemaker-container) (2026-02-19)

*No description available.*

### [mira-hq](https://github.com/shepherdjerred/monorepo/tree/main/archive/mira-hq) (2026-02-19)

*No description available.*

### [instalike](https://github.com/shepherdjerred/monorepo/tree/main/archive/instalike) (2026-02-19)

*No description available.*

### [push-pal](https://github.com/shepherdjerred/monorepo/tree/main/archive/push-pal) (2026-02-19)

*No description available.*

### [trip-sim](https://github.com/shepherdjerred/monorepo/tree/main/archive/trip-sim) (2026-02-19)

*No description available.*

### [easely](https://github.com/shepherdjerred/monorepo/tree/main/archive/easely) (2026-02-19)

*No description available.*

### [kittens](https://github.com/shepherdjerred/monorepo/tree/main/archive/kittens) (2026-02-19)

*No description available.*

### [hu-easel](https://github.com/shepherdjerred/monorepo/tree/main/archive/hu-easel) (2026-02-19)

*No description available.*

<!--[[[end]]]-->
