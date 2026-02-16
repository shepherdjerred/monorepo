# Python Tooling and Packaging

Guide to modern Python tooling: uv (package/project manager), ruff (linter+formatter), pip, poetry, venv, pyproject.toml, dependency management, mypy vs pyright, and build backends.

## uv (Fast Python Package and Project Manager)

uv is an extremely fast Python package and project manager written in Rust by Astral (same team as Ruff). It replaces pip, pip-tools, pipx, poetry, pyenv, virtualenv, and more in a single tool. It is 10-100x faster than pip.

### Project Management

```bash
# Initialize a new project
uv init my-project            # Application (no src/ layout)
uv init --lib my-library      # Library (src/ layout with py.typed)
uv init --package my-pkg      # Installable package
uv init --script script.py    # Single-file script with inline metadata

# Add/remove dependencies
uv add requests httpx pydantic
uv add "fastapi>=0.110"
uv add --dev pytest ruff mypy coverage
uv add --optional docs mkdocs mkdocs-material
uv remove requests

# Lock and sync
uv lock                       # Generate/update uv.lock
uv sync                       # Install from lockfile
uv sync --frozen              # Error if lockfile out of date
uv sync --no-dev              # Production only

# Run commands in project environment
uv run python script.py
uv run pytest -v
uv run ruff check .
uv run -- python -m http.server 8000

# Build and publish
uv build                      # Build sdist and wheel
uv publish                    # Publish to PyPI
uv publish --token $PYPI_TOKEN
```

### Python Version Management

```bash
# Install Python versions
uv python install 3.14        # Install specific version
uv python install 3.12 3.13   # Install multiple
uv python install --upgrade   # Upgrade to latest patch

# Pin project Python version
uv python pin 3.14            # Creates .python-version file

# List available/installed versions
uv python list
uv python list --only-installed

# Use specific version
uv run --python 3.13 script.py
uv venv --python 3.14
```

### Tool Execution

```bash
# Run tools without installing (like npx)
uvx ruff check .
uvx black --check .
uvx mypy src/
uvx pytest
uvx cowsay "hello"

# Install tools globally
uv tool install ruff
uv tool install "httpie>=3.0"

# List/update/remove tools
uv tool list
uv tool upgrade ruff
uv tool uninstall ruff
```

### Virtual Environments

```bash
# Create venv (uses uv's fast resolver)
uv venv                       # Creates .venv/
uv venv --python 3.14         # Specific Python version
uv venv my-env                # Custom name

# pip-compatible interface
uv pip install requests
uv pip install -r requirements.txt
uv pip install -e ".[dev]"
uv pip compile requirements.in -o requirements.txt
uv pip sync requirements.txt
uv pip list
uv pip show requests
uv pip freeze
uv pip uninstall requests
```

### Workspaces

```bash
# List workspace members
uv workspace list
uv workspace dir

# Add workspace member
# In root pyproject.toml:
# [tool.uv.workspace]
# members = ["packages/*"]
```

### Inline Script Metadata

```python
# script.py - dependencies declared inline
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "requests>=2.31",
#     "rich>=13.0",
# ]
# ///

import requests
from rich import print

response = requests.get("https://api.example.com")
print(response.json())
```

```bash
uv run script.py  # Automatically creates ephemeral env with deps
```

## Ruff (Linter + Formatter)

Ruff is an extremely fast Python linter and formatter written in Rust. It replaces Flake8, Black, isort, pydocstyle, pyupgrade, autoflake, and more. Over 800 built-in rules.

### Commands

```bash
# Linting
ruff check .                        # Check all files
ruff check src/ tests/              # Check specific directories
ruff check --fix .                  # Auto-fix safe fixes
ruff check --fix --unsafe-fixes .   # Include unsafe fixes
ruff check --select E,F,I .         # Only specific rules
ruff check --diff .                 # Show diff of fixes
ruff check --watch .                # Watch mode

# Formatting
ruff format .                       # Format all files
ruff format --check .               # Check without changing
ruff format --diff .                # Show diff
ruff format src/main.py             # Format specific file

# Information
ruff rule E501                      # Explain a rule
ruff linter                         # List available linters
ruff version                        # Show version
```

### Configuration (pyproject.toml)

```toml
[tool.ruff]
target-version = "py312"
line-length = 88
# Exclude patterns
exclude = [
    ".venv",
    "migrations",
    "__pycache__",
]

[tool.ruff.lint]
# Rule selection
select = [
    "E",    # pycodestyle errors
    "F",    # Pyflakes
    "I",    # isort
    "B",    # flake8-bugbear
    "UP",   # pyupgrade
    "N",    # pep8-naming
    "SIM",  # flake8-simplify
    "RUF",  # Ruff-specific rules
    "S",    # flake8-bandit (security)
    "PTH",  # flake8-use-pathlib
    "T20",  # flake8-print (catch print statements)
    "ANN",  # flake8-annotations
    "C4",   # flake8-comprehensions
    "DTZ",  # flake8-datetimez
    "PIE",  # flake8-pie
    "RET",  # flake8-return
    "TCH",  # flake8-type-checking
]
ignore = [
    "E501",    # Line too long (formatter handles this)
    "ANN101",  # Missing type annotation for self
]

# Allow autofix for specific rules
fixable = ["ALL"]
unfixable = []

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = [
    "S101",  # Allow assert in tests
    "ANN",   # Don't require annotations in tests
]
"__init__.py" = ["F401"]  # Allow unused imports in __init__

[tool.ruff.lint.isort]
known-first-party = ["mypackage"]
force-single-line = false
lines-after-imports = 2

[tool.ruff.lint.pydocstyle]
convention = "google"  # or "numpy", "pep257"

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
skip-magic-trailing-comma = false
line-ending = "auto"
docstring-code-format = true
```

### Common Rule Categories

| Code | Plugin | Purpose |
|------|--------|---------|
| E/W | pycodestyle | Style errors and warnings |
| F | Pyflakes | Logical errors (unused imports, undefined names) |
| I | isort | Import sorting |
| B | flake8-bugbear | Common bugs and design problems |
| UP | pyupgrade | Modernize syntax for target Python version |
| N | pep8-naming | Naming conventions |
| S | flake8-bandit | Security issues |
| SIM | flake8-simplify | Simplifiable code |
| RUF | Ruff-specific | Ruff's own rules |
| PTH | flake8-use-pathlib | Prefer pathlib over os.path |
| T20 | flake8-print | Detect print() calls |
| C4 | flake8-comprehensions | Simplify comprehensions |
| TCH | flake8-type-checking | Move imports to TYPE_CHECKING |

### Inline Suppressions

```python
x = 1  # noqa: F841
x = 1  # noqa: F841, E501

# Disable for block
# ruff: noqa: E501

# File-level
# ruff: noqa
```

## pip (Standard Package Installer)

```bash
# Install packages
pip install requests
pip install "requests>=2.31,<3"
pip install -r requirements.txt
pip install -e ".[dev]"           # Editable install with extras

# List and inspect
pip list
pip list --outdated
pip show requests
pip freeze > requirements.txt

# Uninstall
pip uninstall requests

# Upgrade
pip install --upgrade requests
pip install --upgrade pip
```

## Poetry (Alternative Project Manager)

```bash
# Create/init project
poetry new my-project
poetry init  # In existing directory

# Dependencies
poetry add requests
poetry add --group dev pytest ruff
poetry remove requests

# Lock and install
poetry lock
poetry install
poetry install --no-dev

# Run
poetry run python script.py
poetry run pytest

# Build and publish
poetry build
poetry publish
```

Poetry 2.0+ (Jan 2025) uses standard `[project]` table in pyproject.toml instead of `[tool.poetry]`.

## Virtual Environments

### stdlib venv

```bash
python -m venv .venv
source .venv/bin/activate        # macOS/Linux (bash/zsh)
source .venv/bin/activate.fish   # Fish shell
.venv/Scripts/activate           # Windows

deactivate                       # Exit venv

# Recreate from scratch
rm -rf .venv && python -m venv .venv
```

### Why Virtual Environments Matter

- Isolate project dependencies from system Python
- Prevent version conflicts between projects
- Reproducible environments via lockfiles
- uv/poetry handle venvs automatically

## pyproject.toml

The central configuration file for modern Python projects. Replaces setup.py, setup.cfg, requirements.txt, and tool-specific config files.

### Full Example

```toml
[project]
name = "my-awesome-package"
version = "1.0.0"
description = "A short description"
readme = "README.md"
license = "MIT"
requires-python = ">=3.12"
authors = [
    { name = "Your Name", email = "you@example.com" },
]
keywords = ["python", "example"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Programming Language :: Python :: 3.14",
]
dependencies = [
    "httpx>=0.27",
    "pydantic>=2.0",
    "click>=8.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-cov>=5.0",
    "pytest-asyncio>=0.24",
    "ruff>=0.8",
    "mypy>=1.13",
]
docs = [
    "mkdocs>=1.6",
    "mkdocs-material>=9.0",
]

[project.scripts]
my-cli = "my_package.cli:main"

[project.urls]
Homepage = "https://github.com/user/project"
Documentation = "https://project.readthedocs.io"
Repository = "https://github.com/user/project"

# Build backend
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

# Tool configurations
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra -q --strict-markers"
asyncio_mode = "auto"
markers = [
    "slow: marks tests as slow (deselect with '-m \"not slow\"')",
    "integration: marks integration tests",
]

[tool.mypy]
python_version = "3.14"
strict = true
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true

[[tool.mypy.overrides]]
module = "tests.*"
disallow_untyped_defs = false

[tool.coverage.run]
source = ["src"]
branch = true

[tool.coverage.report]
show_missing = true
skip_empty = true
fail_under = 80

[tool.ruff]
target-version = "py312"
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
```

### Build Backends

| Backend | Use Case | Config |
|---------|----------|--------|
| **hatchling** | Modern default, fast, extensible | `requires = ["hatchling"]` |
| **setuptools** | Legacy, most common historically | `requires = ["setuptools>=61.0"]` |
| **flit-core** | Simple pure-Python packages | `requires = ["flit_core>=3.4"]` |
| **pdm-backend** | PDM projects | `requires = ["pdm-backend"]` |
| **maturin** | Rust+Python packages | `requires = ["maturin>=1.0"]` |

Hatchling is recommended for new projects. Setuptools if you need compatibility with older tooling.

### Project Layouts

```
# src layout (recommended for libraries)
my-project/
  src/
    my_package/
      __init__.py
      core.py
  tests/
    test_core.py
  pyproject.toml

# flat layout (simpler, fine for applications)
my-project/
  my_package/
    __init__.py
    core.py
  tests/
    test_core.py
  pyproject.toml
```

## mypy vs pyright

### mypy (Python Foundation)

```bash
mypy src/
mypy --strict src/
mypy --show-error-codes src/
```

```toml
[tool.mypy]
python_version = "3.14"
strict = true
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
check_untyped_defs = true
no_implicit_reexport = true

[[tool.mypy.overrides]]
module = "third_party_lib.*"
ignore_missing_imports = true
```

### pyright (Microsoft, used by VS Code/Pylance)

```bash
pyright src/
pyright --pythonversion 3.14
```

```json
// pyrightconfig.json
{
    "pythonVersion": "3.14",
    "typeCheckingMode": "strict",
    "reportMissingImports": true,
    "reportMissingTypeStubs": false,
    "include": ["src"],
    "exclude": ["**/__pycache__", ".venv"]
}
```

Or in pyproject.toml:
```toml
[tool.pyright]
pythonVersion = "3.14"
typeCheckingMode = "strict"
include = ["src"]
```

### Comparison

| Feature | mypy | pyright |
|---------|------|---------|
| Speed | Slower (Python) | Faster (Node.js) |
| VS Code | Via extension | Built into Pylance |
| Plugins | mypy plugins API | Limited |
| Protocol support | Good | Excellent |
| Error messages | Detailed | Detailed |
| Incremental | Yes | Yes |
| Daemon mode | mypy daemon (dmypy) | Built-in |
| Strictness | Configurable | Basic/Standard/Strict |

Use **pyright** for VS Code integration and speed. Use **mypy** for CI, plugins, or specific features. Both can be used together.

## Dependency Management Best Practices

1. **Use uv** for new projects - fastest, most modern
2. **Lock dependencies** - `uv lock` or `poetry lock` for reproducible builds
3. **Pin direct deps loosely** - `httpx>=0.27` not `httpx==0.27.2`
4. **Separate dev deps** - `[project.optional-dependencies]` or `[dependency-groups]`
5. **Use extras** for optional features - `pip install "pkg[postgres]"`
6. **Keep lockfile in version control** - `uv.lock` or `poetry.lock`
7. **Audit regularly** - `pip audit` or `uv pip audit` for vulnerabilities

## Common Project Scripts

```toml
# In pyproject.toml with hatchling
[project.scripts]
my-cli = "my_package.cli:main"

# Or entry points for plugins
[project.entry-points."my_app.plugins"]
my_plugin = "my_package.plugins:MyPlugin"
```

```bash
# Using uv run for dev tasks
uv run pytest -v
uv run ruff check --fix .
uv run ruff format .
uv run mypy src/
uv run python -m my_package
```

## Docker Patterns for Python

```dockerfile
# Multi-stage build with uv
FROM python:3.14-slim AS builder

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./

# Install dependencies (cached layer)
RUN uv sync --frozen --no-dev --no-editable

COPY src/ src/

FROM python:3.14-slim AS runtime
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src

ENV PATH="/app/.venv/bin:$PATH"
CMD ["python", "-m", "my_package"]
```

```dockerfile
# Simple Dockerfile with pip
FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
```

### .dockerignore
```
.venv/
__pycache__/
*.pyc
.git/
.ruff_cache/
.mypy_cache/
.pytest_cache/
dist/
build/
*.egg-info/
```

## CI/CD Patterns

### GitHub Actions with uv

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.12", "3.13", "3.14"]
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5

      - name: Set up Python
        run: uv python install ${{ matrix.python-version }}

      - name: Install dependencies
        run: uv sync --frozen

      - name: Lint
        run: uv run ruff check .

      - name: Format check
        run: uv run ruff format --check .

      - name: Type check
        run: uv run mypy src/

      - name: Test
        run: uv run pytest --cov=src --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: coverage.xml
```

### Pre-commit Hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.8.6
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.14.1
    hooks:
      - id: mypy
        additional_dependencies: [pydantic]
```

```bash
# Install pre-commit
uv tool install pre-commit
pre-commit install
pre-commit run --all-files
```

## Environment Variables and Configuration

### pydantic-settings (Recommended for Apps)

```python
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    model_config = {"env_prefix": "APP_", "env_file": ".env"}

    database_url: str
    redis_url: str = "redis://localhost:6379"
    debug: bool = False
    secret_key: str = Field(min_length=32)
    allowed_hosts: list[str] = ["localhost"]

settings = Settings()  # Reads from APP_DATABASE_URL, APP_DEBUG, etc.
```

### .env Files

```bash
# .env (never commit this)
APP_DATABASE_URL=postgresql://user:pass@localhost/db
APP_SECRET_KEY=your-secret-key-here
APP_DEBUG=true
```

```python
# Load manually if not using pydantic-settings
from dotenv import load_dotenv
import os

load_dotenv()
db_url = os.getenv("DATABASE_URL", "sqlite:///default.db")
```

## Logging Configuration

```python
import logging
import logging.config

# Basic setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)
logger.info("Application started")
logger.warning("Low memory", extra={"available_mb": 100})

# Structured logging with structlog (recommended)
import structlog

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),  # Or JSONRenderer() for production
    ],
)

log = structlog.get_logger()
log.info("user.login", user_id=42, ip="192.168.1.1")
```

## Makefile / Task Runner Patterns

```makefile
# Makefile - common Python project tasks
.PHONY: install test lint format check clean

install:
	uv sync

test:
	uv run pytest -v --cov=src

lint:
	uv run ruff check .

format:
	uv run ruff format .
	uv run ruff check --fix .

typecheck:
	uv run mypy src/

check: lint typecheck test

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov dist build
	find . -type d -name __pycache__ -exec rm -rf {} +
```

Or use `[project.scripts]` in pyproject.toml for project-specific commands:
```toml
[project.scripts]
serve = "my_package.main:serve"
migrate = "my_package.db:run_migrations"
```

## Version Specifiers (PEP 440)

```
# Exact
requests==2.31.0

# Minimum
requests>=2.31.0

# Compatible release (>=2.31, <3.0)
requests~=2.31

# Range
requests>=2.28,<3.0

# Exclude
requests!=2.30.0

# Pre-release
requests>=2.32.0rc1

# Extras
httpx[http2]>=0.27
```

## py.typed and Type Stubs

For libraries that ship type information:

```
# Add py.typed marker file (PEP 561)
my_package/
  __init__.py
  py.typed       # Empty file, marks package as typed
  core.py
```

For third-party packages without types:
```bash
# Install type stubs
uv add --dev types-requests types-pyyaml

# Or create custom stubs
# my_package/stubs/third_party.pyi
def some_function(arg: str) -> int: ...
```
