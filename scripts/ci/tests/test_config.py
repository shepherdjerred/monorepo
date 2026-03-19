"""Tests for ci.lib.config module."""

from __future__ import annotations

from unittest.mock import patch

from ci.lib.config import _CI_VERSION_RE, ReleaseConfig


class TestCIVersionRegex:
    def test_matches_multiline_format(self) -> None:
        content = (
            '  "shepherdjerred/birmel":\n'
            '    "1.1.137@sha256:abc",\n'
            '  "shepherdjerred/sentinel":\n'
            '    "1.1.139@sha256:def",'
        )
        patches = [int(m.group(1)) for m in _CI_VERSION_RE.finditer(content)]
        assert sorted(patches) == [137, 139]

    def test_ignores_external_versions(self) -> None:
        content = '  "cert-manager": "v1.19.2",\n  "shepherdjerred/birmel":\n    "1.1.100@sha256:abc",'
        patches = [int(m.group(1)) for m in _CI_VERSION_RE.finditer(content)]
        assert patches == [100]

    def test_ignores_renovate_managed_versions(self) -> None:
        content = '  "redlib/redlib":\n    "latest@sha256:abc",\n  "shepherdjerred/birmel":\n    "1.1.50@sha256:def",'
        patches = [int(m.group(1)) for m in _CI_VERSION_RE.finditer(content)]
        assert patches == [50]

    def test_empty_content(self) -> None:
        patches = [int(m.group(1)) for m in _CI_VERSION_RE.finditer("")]
        assert patches == []

    def test_no_ci_versions(self) -> None:
        content = '  "cert-manager": "v1.19.2",\n  "redlib/redlib": "latest",'
        patches = [int(m.group(1)) for m in _CI_VERSION_RE.finditer(content)]
        assert patches == []


class TestForLocal:
    def test_generates_version_with_patch(self) -> None:
        with patch("ci.lib.config._next_local_patch", return_value=140):
            config = ReleaseConfig.for_local()
        assert config.version.startswith("1.1.140-local.")
        assert config.is_release is False
        assert config.build_number == 0

    def test_version_override_skips_generation(self) -> None:
        config = ReleaseConfig.for_local(version="9.9.9")
        assert config.version == "9.9.9"
        assert config.is_release is False

    def test_prerelease_timestamp_format(self) -> None:
        with patch("ci.lib.config._next_local_patch", return_value=42):
            config = ReleaseConfig.for_local()
        assert config.version.startswith("1.1.42-local.")
        ts_part = config.version.split("-local.")[1]
        assert len(ts_part) == 14
        assert ts_part.isdigit()

    def test_zero_patch_when_no_versions(self) -> None:
        with patch("ci.lib.config._next_local_patch", return_value=1):
            config = ReleaseConfig.for_local()
        assert config.version.startswith("1.1.1-local.")
