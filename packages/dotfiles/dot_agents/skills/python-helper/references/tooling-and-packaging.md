# Python tooling and packaging

Read this when configuring uv, pip, pyproject.toml, publishing, Ruff, mypy, or Pyright.

## uv project workflow

The project interface manages environments, lockfiles, synchronization, dependencies, and commands. Commit `uv.lock`.

```bash
uv sync --locked
uv run pytest
uv add <dependency>
uv add --dev <development-tool>
```

`--locked` verifies freshness. `--frozen` trusts the existing lock without checking project metadata. Use workspaces only when members can share one lock, environment, and combined `requires-python` range.

## Dependency categories

`[dependency-groups].dev` is for development dependencies. `[project.optional-dependencies]` defines extras that consumers can install from the built package.

The `uv pip` interface directly manages an environment and is intentionally not completely pip-compatible. Use it for low-level or migration workflows, not as a synonym for uv projects.

## Build and publish

Build published packages without local workspace source overrides:

```bash
uv build --no-sources
```

Prefer trusted publishing. If credentials are necessary, use the documented environment variable or stdin path rather than expanding a token into a command argument. Publication needs explicit authorization.

## pip

Requirements select installations; constraints limit versions without requesting installation. `pip freeze` records one environment. `pip lock` is experimental and platform/Python-specific.

Hash checking is all-or-nothing: every requirement and dependency needs a hash. `--only-binary :all:` removes source-build risk at the cost of requiring compatible wheels.

## Ruff

Ruff can infer Python target version from `requires-python`. Safe fixes intend to preserve behavior; unsafe fixes may change behavior or remove comments. Preview behavior has weaker stability, and Ruff's pre-1.0 versioning permits breaking minor releases.

Remove obsolete rules such as `ANN101` from copied configurations. Review every enabled rule set against the pinned Ruff version.

## Type-checkers

Mypy 2.3 documentation notes that its native parser is not yet the default. Pyright defaults to standard mode and supports strict mode and per-environment Python/platform settings.

Use the repository's chosen checker and configuration. Do not add `--ignore-missing-imports` as a blanket escape hatch.

## Auditing and images

Use `uv run --with pip-audit pip-audit` to audit the project's synced environment for the current interpreter and platform; it works regardless of uv version. This audits only that one active environment, not every locked platform/dependency combination in the lockfile — pass `-r <file>` to additionally audit a specific requirements file. Use `uv run --with`, not `uvx` — `uvx pip-audit` runs in its own isolated tool environment and audits pip-audit's dependencies rather than the project's, while `uv run --with pip-audit` layers pip-audit onto the project's synced environment. `uv audit` remains a preview-only subcommand (behind `--preview`) and is absent entirely in older uv releases, so do not depend on it unconditionally. Vulnerability findings require reachability and remediation review; the command must remain a failing gate when policy requires it.

Pin container tools by reviewed version or immutable digest. Do not copy `latest` into a reproducible build.

## Primary documentation

- [Packaging Python projects](https://packaging.python.org/en/latest/tutorials/packaging-projects/)
- [Writing pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)
- [pip install](https://pip.pypa.io/en/stable/cli/pip_install/)
- [pip lock](https://pip.pypa.io/en/stable/cli/pip_lock/)
- [Secure pip installs](https://pip.pypa.io/en/stable/topics/secure-installs/)
- [uv projects](https://docs.astral.sh/uv/guides/projects/)
- [uv project layout](https://docs.astral.sh/uv/concepts/projects/layout/)
- [uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/)
- [uv configuration](https://docs.astral.sh/uv/concepts/projects/config/)
- [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/)
- [uv packaging](https://docs.astral.sh/uv/guides/package/)
- [uv publishing](https://docs.astral.sh/uv/guides/publish/)
- [uv pip interface](https://docs.astral.sh/uv/pip/)
- [uv CLI](https://docs.astral.sh/uv/reference/cli/)
- [Ruff configuration](https://docs.astral.sh/ruff/configuration/)
- [Ruff formatter](https://docs.astral.sh/ruff/formatter/)
- [Ruff linter](https://docs.astral.sh/ruff/linter/)
- [Ruff versioning](https://docs.astral.sh/ruff/versioning/)
- [Mypy release notes](https://mypy.readthedocs.io/en/stable/changelog.html)
- [Pyright configuration](https://microsoft.github.io/pyright/#/configuration)
