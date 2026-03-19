"""Tests for ci.lib.buildkite module."""

from __future__ import annotations

import subprocess
import tempfile
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest

from ci.lib import buildkite

if TYPE_CHECKING:
    from pathlib import Path


class TestGetMetadata:
    @patch("shutil.which", return_value=None)
    def test_returns_default_when_no_agent(self, _mock: MagicMock) -> None:
        with tempfile.TemporaryDirectory() as td, patch.dict("os.environ", {"MONOREPO_CI_RUN_DIR": td}):
            assert buildkite.get_metadata("key", "fallback") == "fallback"

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_returns_value_on_success(self, mock_run: MagicMock, _mock_which: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=0, stdout="some-value\n")
        assert buildkite.get_metadata("key") == "some-value"
        mock_run.assert_called_once_with(
            ["buildkite-agent", "meta-data", "get", "key", "--default", ""],
            capture_output=True,
            text=True,
            check=False,
        )

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_returns_default_on_failure(self, mock_run: MagicMock, _mock_which: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=1, stdout="")
        assert buildkite.get_metadata("key", "default") == "default"

    @patch("shutil.which", return_value=None)
    def test_returns_empty_string_default(self, _mock: MagicMock) -> None:
        with tempfile.TemporaryDirectory() as td, patch.dict("os.environ", {"MONOREPO_CI_RUN_DIR": td}):
            assert buildkite.get_metadata("key") == ""


class TestSetMetadata:
    @patch("shutil.which", return_value=None)
    def test_writes_to_local_json_when_no_agent(self, _mock: MagicMock) -> None:
        with tempfile.TemporaryDirectory() as td, patch.dict("os.environ", {"MONOREPO_CI_RUN_DIR": td}):
            buildkite.set_metadata("key", "value")

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_calls_with_check_true(self, mock_run: MagicMock, _mock_which: MagicMock) -> None:
        buildkite.set_metadata("key", "value")
        mock_run.assert_called_once_with(
            ["buildkite-agent", "meta-data", "set", "key", "value"],
            check=True,
        )

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run", side_effect=subprocess.CalledProcessError(1, "cmd"))
    def test_raises_on_failure(self, _mock_run: MagicMock, _mock_which: MagicMock) -> None:
        with pytest.raises(subprocess.CalledProcessError):
            buildkite.set_metadata("key", "value")


class TestAnnotate:
    @patch("shutil.which", return_value=None)
    def test_prints_to_stderr_when_no_agent(self, _mock: MagicMock) -> None:
        buildkite.annotate("msg")

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_calls_annotate(self, mock_run: MagicMock, _mock_which: MagicMock) -> None:
        buildkite.annotate("error msg", style="warning", context="test")
        mock_run.assert_called_once_with(
            [
                "buildkite-agent",
                "annotate",
                "error msg",
                "--style",
                "warning",
                "--context",
                "test",
            ],
            check=False,
        )

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_default_style_and_context(self, mock_run: MagicMock, _mock_which: MagicMock) -> None:
        buildkite.annotate("msg")
        mock_run.assert_called_once_with(
            [
                "buildkite-agent",
                "annotate",
                "msg",
                "--style",
                "error",
                "--context",
                "default",
            ],
            check=False,
        )


class TestArtifactUpload:
    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_uploads_via_agent(self, mock_run: MagicMock, _mock_which: MagicMock, tmp_path: Path) -> None:
        test_file = tmp_path / "artifact.txt"
        test_file.write_text("content")
        buildkite.artifact_upload(str(test_file))
        mock_run.assert_called_once_with(
            ["buildkite-agent", "artifact", "upload", str(test_file)],
            check=True,
        )

    @patch("shutil.which", return_value=None)
    def test_copies_to_staging_when_no_agent(self, _mock: MagicMock, tmp_path: Path) -> None:
        with patch.dict("os.environ", {"MONOREPO_CI_RUN_DIR": str(tmp_path)}):
            src = tmp_path / "src_file.txt"
            src.write_text("artifact content")
            buildkite.artifact_upload(str(src))
            staged = tmp_path / "artifacts" / "src_file.txt"
            assert staged.exists()
            assert staged.read_text() == "artifact content"


class TestArtifactDownload:
    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_downloads_via_agent(self, mock_run: MagicMock, _mock_which: MagicMock, tmp_path: Path) -> None:
        result = buildkite.artifact_download("file.txt", str(tmp_path))
        mock_run.assert_called_once_with(
            ["buildkite-agent", "artifact", "download", "file.txt", str(tmp_path) + "/"],
            check=True,
        )
        assert result == tmp_path / "file.txt"

    @patch("shutil.which", return_value=None)
    def test_reads_from_staging_dir(self, _mock: MagicMock, tmp_path: Path) -> None:
        with patch.dict("os.environ", {"MONOREPO_CI_RUN_DIR": str(tmp_path)}):
            artifacts_dir = tmp_path / "artifacts"
            artifacts_dir.mkdir()
            (artifacts_dir / "test.bin").write_text("binary data")
            dest = tmp_path / "dest"
            result = buildkite.artifact_download("test.bin", str(dest))
            assert (dest / "test.bin").read_text() == "binary data"
            assert result == dest / "test.bin"


class TestLocalMetadataRoundtrip:
    @patch("shutil.which", return_value=None)
    def test_write_then_read(self, _mock: MagicMock) -> None:
        with tempfile.TemporaryDirectory() as td, patch.dict("os.environ", {"MONOREPO_CI_RUN_DIR": td}):
            buildkite.set_metadata("round_trip_key", "round_trip_value")
            assert buildkite.get_metadata("round_trip_key") == "round_trip_value"
            assert buildkite.get_metadata("missing", "fallback") == "fallback"

    @patch("shutil.which", return_value=None)
    def test_multiple_keys(self, _mock: MagicMock) -> None:
        with tempfile.TemporaryDirectory() as td, patch.dict("os.environ", {"MONOREPO_CI_RUN_DIR": td}):
            buildkite.set_metadata("key1", "val1")
            buildkite.set_metadata("key2", "val2")
            assert buildkite.get_metadata("key1") == "val1"
            assert buildkite.get_metadata("key2") == "val2"
