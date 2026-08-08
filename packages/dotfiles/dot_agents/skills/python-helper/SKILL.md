---
name: python-helper
description: Current Python development guidance for versions, uv and pip, packaging, typing, asyncio, pytest, Ruff, security, and runtime boundaries. Use when writing or reviewing Python, pyproject.toml, Python CI, tests, dependency workflows, or Python upgrades.
---

# Python Helper

Follow the project's declared Python version and dependency workflow. Validate runtime data, make async ownership explicit, and distinguish read-only checks, local mutations, and external publication.

## Current baseline

Verified 2026-08-03:

| Line | Status |
| --- | --- |
| Python 3.14.6 | Current stable; 3.14 and 3.13 are bugfix branches |
| Python 3.12, 3.11, 3.10 | Security-only branches |
| Python 3.15.0b4 | Prerelease; RC1 was scheduled for 2026-08-04 and final for 2026-10-01 |

Python 3.14.7 was scheduled for the day after this verification. Check live status before repeating a patch number:

```bash
python --version
uv --version
```

The project's `requires-python` is the syntax and standard-library ceiling. Do not use a current interpreter to justify APIs outside that declared range.

Read [references/releases.md](references/releases.md) for the 48-page research ledger and 3.14/3.15 features. Read [references/tooling-and-packaging.md](references/tooling-and-packaging.md) for uv, pip, publishing, Ruff, and type-checkers. Read [references/testing-and-concurrency.md](references/testing-and-concurrency.md) for pytest, asyncio, TaskGroup, interpreters, and free threading. Read [references/types-and-security.md](references/types-and-security.md) for typed boundaries, deferred annotations, subprocesses, archives, and secrets.

## Command authority

Read-only or check-oriented commands:

```bash
python --version
uv --version
uv python list
uv tree
ruff check .
ruff format --check .
pytest --collect-only
mypy .
pyright
```

Local mutations include `uv add`, `uv sync`, `uv python install`, `uv python pin`, `ruff check --fix`, and `ruff format`. Ruff unsafe fixes can change runtime behavior or remove comments; require an explicit diff review and focused tests.

`uv publish` mutates an external registry. Require explicit artifacts, registry, credentials, and publication authorization.

## uv projects

Use uv's project interface for a uv-managed application or package:

```bash
uv sync --locked
uv run pytest
uv add httpx
uv add --dev pytest ruff
```

- Commit `uv.lock`; it is a universal exact-resolution lockfile.
- `--locked` checks that project metadata and lock agree.
- `--frozen` uses the lock without checking whether project metadata changed; it is not the stricter CI option.
- Development tools belong in `[dependency-groups].dev`.
- `[project.optional-dependencies]` defines consumer-installable extras.
- `uv pip` is the lower-level environment interface, not the default project/lock workflow.
- `uv --version` reports the uv binary. `uv version` reads or can update the project version.

## pip boundaries

Use `python -m pip` inside a verified virtual environment when a project uses pip. `pip freeze` is an environment snapshot, not a portable lock or secure supply-chain workflow. `pip lock` remains experimental and its `pylock.toml` is specific to the current Python/platform.

Secure requirements installs need complete hashes and may disallow source distributions:

```bash
python -m pip install --require-hashes --only-binary :all: -r requirements.txt
```

## Type and validate boundaries

Avoid bare `dict` and `list[dict]`; they introduce imprecise values. Use dataclasses, `TypedDict`, Pydantic models, or precise mappings according to whether runtime validation is needed.

```python
from pydantic import BaseModel, TypeAdapter


class User(BaseModel):
    id: int
    email: str


Users = TypeAdapter(list[User])
users = Users.validate_python(response.json())
```

Check HTTP status before parsing. A type annotation does not validate JSON, environment variables, database results, cache values, or deserialized files.

Use `Any` only where disabling checking is intentional and isolated. Prefer `object` or `unknown`-equivalent validation patterns at boundaries. Use `Never` for exhaustiveness.

`TypeIs` narrows both branches and requires the narrowed type to be a subtype. `TypeGuard` remains necessary for some invariant-container or otherwise non-subtype narrowing. Neither is universally preferred.

## Async and concurrency

Use `TaskGroup` when sibling cancellation and grouped failures are the intended semantics. `asyncio.gather()` does not cancel sibling awaitables merely because one fails. `return_exceptions=True` turns exceptions into results and must not silently normalize failure.

Reuse clients so connection pooling works:

```python
import asyncio

import httpx


async def fetch_all(urls: list[str]) -> list[str]:
    async with httpx.AsyncClient() as client:
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(fetch_text(client, url)) for url in urls]
    return [task.result() for task in tasks]


async def fetch_text(client: httpx.AsyncClient, url: str) -> str:
    response = await client.get(url)
    response.raise_for_status()
    return response.text
```

Own the event loop at the application boundary. Do not monkey-patch it with archived `nest_asyncio`; use top-level `await` in notebooks or refactor nested `asyncio.run()` calls.

Subinterpreters have separate execution contexts and GILs but are not security boundaries. Free-threaded Python is supported in 3.14, yet extensions can re-enable the GIL and shared state still requires synchronization.

## Tests

Current pytest documentation is 9.1.1. Avoid embedding volatile minimum-version pins unless compatibility requires them.

- Use exact state, value, status, body, and side-effect assertions.
- Do not skip “not implemented” behavior or xfail known bugs to make the suite green.
- Use controlled servers or HTTP fakes instead of `example.com`.
- Prefer `--import-mode=importlib` for new projects and a src layout where appropriate.
- Use pytest-asyncio `auto` only when asyncio is the suite's sole async framework; use strict mode for plugin coexistence.
- `-n auto` is pytest-xdist, and coverage flags are pytest-cov, not core pytest.

## Ruff and type-checkers

Let Ruff infer `target-version` from `requires-python` or set the true minimum. Formatting is best-effort against line length; E501 can still report a formatted line. Use safe fixes by default and note that Ruff is pre-1.0, so minor releases can contain breaking changes.

Choose mypy or Pyright from the repository's existing configuration, plugin needs, editor integration, and intended strictness. Do not suppress missing imports globally or claim one checker is categorically the “CI” or “fast” choice.

## Security

- Use `secrets`, not `random`, for tokens and credential material.
- Pass subprocess argument sequences; avoid `shell=True` with untrusted input.
- Never unpickle untrusted data.
- Keep tarfile's safer `data` filter and inspect untrusted archives even on Python 3.14.
- Audit with `uv run --with pip-audit pip-audit`, not the nonexistent
  `pip audit` / `uv pip audit` commands. Use `uv run --with`, not `uvx`: `uvx
  pip-audit` runs pip-audit in its own isolated tool environment and audits
  pip-audit's dependencies, not the project's; `uv run --with pip-audit`
  layers pip-audit onto the project's synced environment so it inspects the
  project's actual installed packages. `uv audit` remains a preview-only
  subcommand (behind `--preview`) and is absent entirely in older uv releases,
  so don't rely on it as a stable, version-independent option.
- Fail on missing required environment configuration; do not silently switch databases.
- Prefer trusted publishing and pinned container artifacts over static tokens and `latest` tags.
- Open text files with an explicit encoding while Python 3.14 remains platform-sensitive by default.

## Review checklist

- Verify Python, uv, and the project's `requires-python` range.
- Separate read-only checks, local mutations, and external publication.
- Commit and enforce the lock with `--locked` in CI.
- Validate external data before returning domain types.
- Keep async failure and cancellation semantics explicit.
- Reuse network clients and check response status.
- Use exact tests without skips, weak assertions, or real public-network dependencies.
- Keep Ruff fixes safe unless an unsafe fix is explicitly reviewed.
- Avoid archived monkey patches and unqualified performance claims.
- Check security-sensitive serialization, subprocess, archive, secret, and publishing boundaries.
