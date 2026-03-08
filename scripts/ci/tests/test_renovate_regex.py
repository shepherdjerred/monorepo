"""Tests for Renovate custom regex manager patterns.

Validates that the regex patterns in renovate.json correctly match
the formats used across the codebase for version annotations.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_custom_managers() -> list[dict]:
    """Load custom managers from renovate.json."""
    renovate_path = REPO_ROOT / "renovate.json"
    config = json.loads(renovate_path.read_text())
    return config.get("customManagers", [])


def _re2_to_python(pattern: str) -> str:
    """Convert RE2 named groups (?<name>...) to Python (?P<name>...)."""
    return re.sub(r'\(\?<([^>]+)>', r'(?P<\1>', pattern)


def _find_manager(description_prefix: str) -> list[re.Pattern[str]]:
    """Find a custom manager by description prefix and return compiled regexes."""
    for manager in _load_custom_managers():
        desc = manager.get("description", "")
        if desc.startswith(description_prefix):
            return [re.compile(_re2_to_python(pat)) for pat in manager.get("matchStrings", [])]
    raise ValueError(f"No manager found with description starting with: {description_prefix}")


def _match_any(patterns: list[re.Pattern[str]], text: str) -> re.Match[str] | None:
    """Try to match text against any of the patterns."""
    for pat in patterns:
        m = pat.search(text)
        if m:
            return m
    return None


class TestCIScriptPatterns:
    """Tests for the 'CI tool versions in Buildkite scripts and Dockerfiles' manager."""

    @pytest.fixture()
    def patterns(self) -> list[re.Pattern[str]]:
        return _find_manager("CI tool versions")

    def test_shell_variable_quoted(self, patterns: list[re.Pattern[str]]) -> None:
        text = '# renovate: datasource=github-releases depName=bazelbuild/bazelisk\nBAZELISK_VERSION="1.28.1"'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "github-releases"
        assert m.group("depName") == "bazelbuild/bazelisk"
        assert m.group("currentValue") == "1.28.1"

    def test_dockerfile_arg(self, patterns: list[re.Pattern[str]]) -> None:
        text = "# renovate: datasource=github-releases depName=astral-sh/uv\nARG UV_VERSION=0.6.9"
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "github-releases"
        assert m.group("depName") == "astral-sh/uv"
        assert m.group("currentValue") == "0.6.9"

    def test_versioning_optional(self, patterns: list[re.Pattern[str]]) -> None:
        text = '# renovate: datasource=github-tags depName=aws/aws-cli versioning=semver\nAWSCLI_VERSION="2.27.22"'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "github-tags"
        assert m.group("depName") == "aws/aws-cli"
        assert m.group("versioning") == "semver"
        assert m.group("currentValue") == "2.27.22"

    def test_v_prefix(self, patterns: list[re.Pattern[str]]) -> None:
        text = '# renovate: datasource=github-releases depName=helm/helm\nHELM_VERSION="v3.17.3"'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("currentValue") == "v3.17.3"

    def test_npm_datasource(self, patterns: list[re.Pattern[str]]) -> None:
        text = '# renovate: datasource=npm depName=@anthropic-ai/claude-code\nCLAUDE_CODE_VERSION="2.1.71"'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "npm"
        assert m.group("depName") == "@anthropic-ai/claude-code"
        assert m.group("currentValue") == "2.1.71"

    def test_pypi_datasource(self, patterns: list[re.Pattern[str]]) -> None:
        text = '# renovate: datasource=pypi depName=cogapp\nCOGAPP_VERSION="3.6.0"'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "pypi"
        assert m.group("depName") == "cogapp"
        assert m.group("currentValue") == "3.6.0"


class TestBazelPatterns:
    """Tests for the 'Versions in Bazel .bzl and BUILD files' manager."""

    @pytest.fixture()
    def patterns(self) -> list[re.Pattern[str]]:
        return _find_manager("Versions in Bazel")

    def test_python_assignment(self, patterns: list[re.Pattern[str]]) -> None:
        text = '# renovate: datasource=github-releases depName=oven-sh/bun\n_DEFAULT_BUN_VERSION = "1.3.9"'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "github-releases"
        assert m.group("depName") == "oven-sh/bun"
        assert m.group("currentValue") == "1.3.9"

    def test_genrule_shell_var(self, patterns: list[re.Pattern[str]]) -> None:
        text = "        # renovate: datasource=github-releases depName=helm/helm\n        HELM_VERSION=v3.17.3 && \\"
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "github-releases"
        assert m.group("depName") == "helm/helm"
        assert m.group("currentValue") == "v3.17.3"

    def test_npm_at_version(self, patterns: list[re.Pattern[str]]) -> None:
        text = "            # renovate: datasource=npm depName=obsidian-headless\n            npm install --global --prefix $$TMPDIR/usr/local obsidian-headless@0.0.4 && \\"
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "npm"
        assert m.group("depName") == "obsidian-headless"
        assert m.group("currentValue") == "0.0.4"


class TestVersionsTsPatterns:
    """Tests for the 'Update versions.ts' manager."""

    @pytest.fixture()
    def patterns(self) -> list[re.Pattern[str]]:
        return _find_manager("Update versions.ts")

    def test_quoted_key_semver(self, patterns: list[re.Pattern[str]]) -> None:
        text = '// renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver\n  "argo-cd": "9.3.4",'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("datasource") == "helm"
        assert m.group("depName") == "argo-cd"
        assert m.group("currentValue") == "9.3.4"

    def test_unquoted_key(self, patterns: list[re.Pattern[str]]) -> None:
        text = '// renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver\n  loki: "6.51.0",'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("depName") == "loki"
        assert m.group("currentValue") == "6.51.0"

    def test_docker_with_digest(self, patterns: list[re.Pattern[str]]) -> None:
        text = '// renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver\n  "linuxserver/radarr":\n    "6.0.4@sha256:270f25698624b57b86ca119cc95399d7ff15be8297095b4e1223fd5b549b732c",'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("depName") == "linuxserver/radarr"
        assert m.group("currentValue") == "6.0.4"
        assert m.group("currentDigest") == "sha256:270f25698624b57b86ca119cc95399d7ff15be8297095b4e1223fd5b549b732c"

    def test_slash_in_key_with_version(self, patterns: list[re.Pattern[str]]) -> None:
        text = '// renovate: datasource=docker registryUrl=https://docker.io versioning=docker\n  "buchgr/bazel-remote-cache": "v2.6.1",'
        m = _match_any(patterns, text)
        assert m is not None
        assert m.group("depName") == "buchgr/bazel-remote-cache"
        assert m.group("currentValue") == "v2.6.1"


class TestActualFiles:
    """Validate that actual files in the repo have correctly formatted renovate comments."""

    def test_setup_tools_all_versions_annotated(self) -> None:
        """Every version variable in setup-tools.sh should have a renovate comment."""
        content = (REPO_ROOT / ".buildkite" / "scripts" / "setup-tools.sh").read_text()
        # Find all lines that set VERSION variables
        version_lines = re.findall(r'^(\w+_VERSION)="', content, re.MULTILINE)
        # Find all renovate comments
        renovate_comments = re.findall(r'^# renovate:', content, re.MULTILINE)
        assert len(version_lines) > 0, "No version variables found"
        assert len(renovate_comments) >= len(version_lines), (
            f"Found {len(version_lines)} version vars but only {len(renovate_comments)} renovate comments"
        )

    def test_ci_dockerfile_all_args_annotated(self) -> None:
        """Every ARG *_VERSION in the CI Dockerfile should have a renovate comment."""
        content = (REPO_ROOT / ".buildkite" / "ci-image" / "Dockerfile").read_text()
        arg_lines = re.findall(r'^ARG (\w+_VERSION)=', content, re.MULTILINE)
        renovate_comments = re.findall(r'^# renovate:', content, re.MULTILINE)
        assert len(arg_lines) > 0, "No ARG version variables found"
        assert len(renovate_comments) >= len(arg_lines), (
            f"Found {len(arg_lines)} ARG version vars but only {len(renovate_comments)} renovate comments"
        )
