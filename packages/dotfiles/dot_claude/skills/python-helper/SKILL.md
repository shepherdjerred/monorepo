---
name: python-helper
description: |
  Python development with modern patterns, type hints, testing, and tooling
  When user works with .py files, mentions Python, pip, pytest, ruff, uv, or encounters Python errors
---

# Python Helper Agent

## What's New in Python (2023-2026)

- **Python 3.14** (Oct 2025): Template strings `t"Hello {name}"` (PEP 750), deferred annotation evaluation (PEP 649), bracketless `except TimeoutError, OSError:` (PEP 758), `concurrent.interpreters` module (PEP 734), `compression.zstd` module (PEP 784), free-threaded mode officially supported (PEP 779), zero-overhead external debugger (PEP 768), `pathlib.Path.copy()/move()`, remote pdb attach `python -m pdb -p PID`, `python -c` auto-dedent, incremental GC with reduced pause times
- **Python 3.13** (Oct 2024): New interactive REPL with multiline editing and color, experimental free-threaded mode (no GIL, `python3.13t`), experimental JIT compiler (PEP 744), `locals()` defined semantics (PEP 667), type parameter defaults `TypeVar('T', default=int)`, `TypeIs` for type narrowing (PEP 742), `ReadOnly` TypedDict fields (PEP 705), `copy.replace()`, `dbm.sqlite3` default backend, `warnings.deprecated()` decorator (PEP 702), iOS/Android tier 3 support, 19 dead-battery modules removed (cgi, telnetlib, etc.)
- **Python 3.12** (Oct 2023): Type parameter syntax `def max[T](args)` (PEP 695), `type` statement for aliases, f-string lifting (nested f-strings, quote reuse, backslashes, comments) (PEP 701), `@override` decorator (PEP 698), `TypedDict` for `**kwargs` via `Unpack` (PEP 692), per-interpreter GIL (PEP 684), comprehension inlining 2x faster (PEP 709), `sys.monitoring` low-impact API, `pathlib.Path.walk()`, `itertools.batched()`, `distutils` removed
- **Current stable**: Python 3.14.2 (Feb 2026)
- **Supported**: 3.10 (security), 3.11 (security), 3.12 (bugfix), 3.13 (bugfix), 3.14 (active)

## Overview

This skill covers Python development using modern patterns (3.10+ features), type hints, dataclasses, structural pattern matching, async/await, and the modern tooling ecosystem: uv (package/project manager), ruff (linter+formatter), pytest (testing), mypy/pyright (type checking), and pyproject.toml-based project configuration.

## CLI Commands

### Auto-Approved Safe Commands

```bash
# Version and environment info
python --version
python -c "import sys; print(sys.version)"
pip list
pip show <package>

# uv commands (fast pip replacement)
uv version
uv python list
uv pip list
uv pip show <package>
uv tree

# Ruff (linter + formatter)
ruff check .
ruff check --fix .
ruff format --check .
ruff format .

# Pytest
pytest
pytest -v
pytest --co  # collect-only, list tests
pytest -x    # stop on first failure

# Type checking
mypy .
pyright .
```

### Project Management with uv

```bash
# Create new project
uv init my-project
uv init --lib my-library

# Add dependencies
uv add requests httpx
uv add --dev pytest ruff mypy

# Lock and sync
uv lock
uv sync

# Run commands in project env
uv run python script.py
uv run pytest
uv run ruff check .

# Python version management
uv python install 3.14
uv python pin 3.14

# Run tools without installing
uvx ruff check .
uvx black --check .

# Build and publish
uv build
uv publish
```

### Virtual Environments

```bash
# Create venv (stdlib)
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
.venv/Scripts/activate     # Windows

# Create venv (uv, faster)
uv venv
uv venv --python 3.14

# pip in venv
pip install -r requirements.txt
pip install -e ".[dev]"
pip freeze > requirements.txt
```

### Ruff Configuration

```bash
# Lint with specific rules
ruff check --select E,F,I,B,UP .
ruff check --fix --unsafe-fixes .

# Format
ruff format .
ruff format --diff .

# Show rule explanation
ruff rule E501
```

Configure in `pyproject.toml`:

```toml
[tool.ruff]
target-version = "py312"
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "N", "SIM", "RUF"]
ignore = ["E501"]

[tool.ruff.lint.isort]
known-first-party = ["mypackage"]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

### Pytest Commands

```bash
# Run all tests
pytest

# Verbose with output capture disabled
pytest -v -s

# Run specific test file/function
pytest tests/test_api.py
pytest tests/test_api.py::test_create_user

# Run by marker
pytest -m "not slow"
pytest -m "integration"

# Parallel execution (pytest-xdist)
pytest -n auto

# Coverage
pytest --cov=src --cov-report=term-missing

# Show local variables on failure
pytest -l

# Re-run failed tests
pytest --lf
pytest --ff  # failed first, then rest
```

### Type Checking

```bash
# mypy
mypy src/
mypy --strict src/
mypy --ignore-missing-imports src/

# pyright (faster, VS Code default)
pyright src/
pyright --pythonversion 3.14
```

## Essential Patterns Quick Reference

### Type Hints (Modern Syntax)

```python
# Union types (3.10+)
def process(value: int | str) -> None: ...

# Optional (3.10+)
def find(name: str) -> User | None: ...

# Generic functions (3.12+)
def first[T](items: list[T]) -> T:
    return items[0]

# Type aliases (3.12+)
type Vector = list[float]
type Result[T] = T | None
type Handler[**P] = Callable[P, Awaitable[None]]
```

### Dataclasses

```python
from dataclasses import dataclass, field

@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float
    label: str = "origin"
    tags: list[str] = field(default_factory=list)
```

### Structural Pattern Matching (3.10+)

```python
match command:
    case {"action": "move", "x": x, "y": y}:
        move_to(x, y)
    case {"action": "quit"}:
        quit_game()
    case str() as text if text.startswith("/"):
        handle_command(text)
    case _:
        print("Unknown command")
```

### Async/Await

```python
import asyncio

async def fetch_all(urls: list[str]) -> list[str]:
    async with httpx.AsyncClient() as client:
        tasks = [client.get(url) for url in urls]
        responses = await asyncio.gather(*tasks)
        return [r.text for r in responses]

asyncio.run(fetch_all(["https://example.com"]))
```

### Error Handling

```python
# Exception groups (3.11+)
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(risky_op())
except* ValueError as eg:
    for exc in eg.exceptions:
        print(f"ValueError: {exc}")
except* TypeError as eg:
    handle_type_errors(eg)

# Custom exceptions
class AppError(Exception):
    def __init__(self, message: str, code: int = 500):
        super().__init__(message)
        self.code = code
```

## pyproject.toml Quick Reference

```toml
[project]
name = "my-package"
version = "0.1.0"
description = "My Python package"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27",
    "pydantic>=2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "ruff>=0.8", "mypy>=1.13"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra -q"
markers = [
    "slow: marks tests as slow",
    "integration: marks integration tests",
]

[tool.mypy]
python_version = "3.14"
strict = true
warn_return_any = true

[tool.ruff]
target-version = "py312"
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
```

## Common Error Patterns and Solutions

### ModuleNotFoundError

```python
# Usually: wrong venv or missing dependency
# Check: which python, pip list
# Fix: uv add <package> or pip install <package>
# If script name shadows stdlib: rename your file (e.g., random.py -> my_random.py)
```

### ImportError with Circular Imports

```python
# Move import inside function, or use TYPE_CHECKING guard
from __future__ import annotations  # Defers all annotation evaluation (pre-3.14)
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from myapp.models import User  # Only imported during type checking

def process(user: User) -> None:  # Works at runtime due to deferred eval
    ...
```

### TypeError: unhashable type

```python
# Mutable types (list, dict, set) can't be dict keys or set members
# Fix: use tuple instead of list, frozenset instead of set
# Or for dataclasses: @dataclass(frozen=True)
```

### asyncio.run() Cannot Be Called from Running Event Loop

```python
# In Jupyter notebooks or nested async contexts:
import asyncio
import nest_asyncio
nest_asyncio.apply()  # Allows nested event loops

# Or use await directly in Jupyter/IPython:
result = await fetch_data()
```

### Common Type Hint Mistakes

```python
# Wrong: mutable default in function signature
def bad(items: list[int] = []) -> None: ...

# Right: use None sentinel
def good(items: list[int] | None = None) -> None:
    if items is None:
        items = []

# Wrong: using dict where TypedDict is better
def process(config: dict) -> None: ...  # No type safety on keys

# Right: TypedDict for structured dicts
class Config(TypedDict):
    host: str
    port: int

def process(config: Config) -> None: ...
```

## Popular Packages by Domain

### Web Frameworks

- **FastAPI** - Async API framework with automatic OpenAPI docs, Pydantic validation
- **Django** - Full-stack framework with ORM, admin, auth, migrations
- **Flask** - Lightweight WSGI micro-framework
- **Starlette** - Async ASGI framework (FastAPI is built on it)

### HTTP Clients

- **httpx** - Modern async/sync HTTP client (recommended, replaces requests for new code)
- **requests** - Simple sync HTTP client (most popular, sync-only)
- **aiohttp** - Async HTTP client/server

### Data Validation

- **Pydantic** (v2) - Data validation with Python type hints, used by FastAPI
- **attrs** - Classes without boilerplate (alternative to dataclasses, more features)
- **msgspec** - Fast serialization/validation

### Data Science / ML

- **pandas** - DataFrames and data analysis
- **polars** - Fast DataFrame library (Rust-based, often 10x faster than pandas)
- **numpy** - Numerical computing
- **scikit-learn** - Machine learning

### Database

- **SQLAlchemy** (v2) - SQL toolkit and ORM
- **SQLModel** - SQLAlchemy + Pydantic (by FastAPI creator)
- **asyncpg** - Fast async PostgreSQL driver
- **alembic** - Database migrations (SQLAlchemy)

### CLI

- **click** - Composable CLI framework
- **typer** - CLI framework built on click with type hints
- **argparse** - Standard library CLI parsing
- **rich** - Rich text, tables, progress bars in terminal

### Testing

- **pytest** - Testing framework (de facto standard)
- **hypothesis** - Property-based testing
- **pytest-asyncio** - Async test support
- **respx** / **pytest-httpx** - Mock httpx requests
- **factory-boy** - Test fixture factories

## Project Structure Patterns

### Application (Flat Layout)

```
my-app/
  my_app/
    __init__.py
    main.py
    config.py
    models.py
    services/
      __init__.py
      user.py
  tests/
    conftest.py
    test_main.py
    test_services/
      test_user.py
  pyproject.toml
  .python-version
```

### Library (src Layout)

```
my-lib/
  src/
    my_lib/
      __init__.py
      py.typed          # Marks package as typed (PEP 561)
      core.py
      _internal.py      # Private module (underscore prefix)
  tests/
    conftest.py
    test_core.py
  pyproject.toml
  .python-version
```

### FastAPI Application

```
my-api/
  src/
    my_api/
      __init__.py
      main.py           # FastAPI app instance
      config.py          # Settings via pydantic-settings
      models/            # Pydantic models
      routes/            # API route handlers
      services/          # Business logic
      db/                # Database models and migrations
  tests/
    conftest.py          # TestClient fixture
    test_routes/
  pyproject.toml
  alembic.ini
```

## Performance Tips

```bash
# Profile first, optimize second
python -m cProfile -s cumulative script.py
python -m cProfile -o profile.pstats script.py

# Line-by-line profiling
pip install line-profiler
kernprof -l -v script.py

# Memory profiling
pip install memray
memray run script.py
memray flamegraph memray-output.bin
```

```python
# Use generators for large datasets
def process_large_file(path: str):
    with open(path) as f:
        for line in f:  # Lazy iteration, constant memory
            yield transform(line)

# Use __slots__ for many instances
class Point:
    __slots__ = ("x", "y")
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

# Use collections for specialized data structures
from collections import defaultdict, Counter, deque
counts = Counter(words)
graph = defaultdict(list)
queue = deque(maxlen=100)

# functools.cache for memoization
from functools import cache

@cache
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
```

## Reference Links

- [Python Docs](https://docs.python.org/3/) - Official documentation
- [What's New in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html)
- [What's New in Python 3.13](https://docs.python.org/3/whatsnew/3.13.html)
- [What's New in Python 3.12](https://docs.python.org/3/whatsnew/3.12.html)
- [typing module](https://docs.python.org/3/library/typing.html) - Type hints reference
- [uv docs](https://docs.astral.sh/uv/) - Package/project manager
- [Ruff docs](https://docs.astral.sh/ruff/) - Linter and formatter
- [pytest docs](https://docs.pytest.org/) - Testing framework
- [mypy docs](https://mypy.readthedocs.io/) - Type checker
- [Pydantic docs](https://docs.pydantic.dev/) - Data validation
- [FastAPI docs](https://fastapi.tiangolo.com/) - API framework
- [Real Python](https://realpython.com/) - Tutorials and guides

## When to Ask for Help

Ask the user for clarification when:

- Choice between sync and async is unclear
- Dependency management strategy (uv vs poetry vs pip) needs deciding
- Type annotation complexity (Protocol vs ABC vs duck typing)
- Testing strategy (unit vs integration vs property-based)
- Project structure decisions (src layout vs flat, monorepo vs separate)
- Performance optimization approach (profiling first)

---

See `references/` for detailed guides:

- `modern-python.md` - Type hints, dataclasses, match statements, async/await, protocols, f-strings
- `tooling-packaging.md` - uv, ruff, pip, poetry, venv, pyproject.toml, mypy vs pyright, build backends
- `testing-patterns.md` - pytest fixtures, parametrize, markers, conftest, mocking, coverage, hypothesis
