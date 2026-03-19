"""Tests for the local CI CLI."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from ci.lib.config import ReleaseConfig
from ci.local import main


class TestVersionCommand:
    def test_version_output(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["version"])
        captured = capsys.readouterr()
        assert "1.1.0-local.test" in captured.out
        assert "abc123" in captured.out


class TestListTargets:
    def test_list_targets_output(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["list-targets"])
        captured = capsys.readouterr()
        assert "homelab-deploy targets" in captured.out
        assert "birmel" in captured.out
        assert "scout" in captured.out
        assert "image-push targets" in captured.out
        assert "helm-push targets" in captured.out


class TestHomelabDeployDryRun:
    def test_scout_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "homelab-deploy", "--target", "scout"])
        captured = capsys.readouterr()
        assert "scout-beta" in captured.out
        assert "scout-prod" in captured.out
        assert "DRY RUN" in captured.out

    def test_tasks_alias_resolves(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "homelab-deploy", "--target", "tasks"])
        captured = capsys.readouterr()
        assert "tasknotes" in captured.out
        assert "tasknotes-server" in captured.out
        assert "obsidian-headless" in captured.out

    def test_missing_target_shows_error(self) -> None:
        with (
            patch.object(
                ReleaseConfig,
                "for_local",
                return_value=ReleaseConfig(
                    version="1.1.0-local.test",
                    git_sha="abc123",
                    branch="main",
                    build_number=0,
                    is_release=False,
                ),
            ),
            pytest.raises(SystemExit),
        ):
            main(["--dry-run", "homelab-deploy"])


class TestImagePushDryRun:
    def test_birmel_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "image-push", "--target", "birmel"])
        captured = capsys.readouterr()
        assert "birmel" in captured.out
        assert "DRY RUN" in captured.out

    def test_invalid_target_fails(self) -> None:
        with (
            patch.object(
                ReleaseConfig,
                "for_local",
                return_value=ReleaseConfig(
                    version="1.1.0-local.test",
                    git_sha="abc123",
                    branch="main",
                    build_number=0,
                    is_release=False,
                ),
            ),
            pytest.raises(SystemExit),
        ):
            main(["--dry-run", "image-push", "--target", "nonexistent"])


class TestHelmPushDryRun:
    def test_chart_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "helm-push", "--target", "scout-beta"])
        captured = capsys.readouterr()
        assert "scout-beta" in captured.out
        assert "DRY RUN" in captured.out


class TestArgocdSyncDryRun:
    def test_argocd_sync_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "argocd-sync", "--app", "birmel"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "birmel" in captured.out


class TestTofuApplyDryRun:
    def test_tofu_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "tofu-apply", "--target", "cloudflare"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "tofu" in captured.out


class TestSiteDeployDryRun:
    def test_site_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "site-deploy", "--target", "sjer.red"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "sjer.red" in captured.out


class TestNpmPublishDryRun:
    def test_npm_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "npm-publish", "--target", "bun-decompile"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "bun-decompile" in captured.out


class TestTagReleaseDryRun:
    def test_tag_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "tag-release", "--tag", "v1.0.0"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "v1.0.0" in captured.out


class TestCooklangReleaseDryRun:
    def test_cooklang_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "cooklang-release", "--version", "1.0.0"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "cooklang-for-obsidian" in captured.out
        assert "1.0.0" in captured.out


class TestClauderonReleaseDryRun:
    def test_clauderon_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "clauderon-release", "--version", "1.0.0"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "clauderon" in captured.out
        assert "1.0.0" in captured.out

    def test_all_targets_dry_run(self, capsys: pytest.CaptureFixture[str]) -> None:
        with patch.object(
            ReleaseConfig,
            "for_local",
            return_value=ReleaseConfig(
                version="1.1.0-local.test",
                git_sha="abc123",
                branch="main",
                build_number=0,
                is_release=False,
            ),
        ):
            main(["--dry-run", "clauderon-release", "--version", "1.0.0", "--all-targets"])
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "x86_64" in captured.out
        assert "aarch64" in captured.out
