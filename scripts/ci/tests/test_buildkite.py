"""Tests for ci.lib.buildkite module."""

from __future__ import annotations

import subprocess
from unittest.mock import MagicMock, patch

import pytest

from ci.lib import buildkite


class TestGetMetadata:
    @patch("shutil.which", return_value=None)
    def test_returns_default_when_no_agent(self, _mock: MagicMock) -> None:
        assert buildkite.get_metadata("key", "fallback") == "fallback"

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_returns_value_on_success(
        self, mock_run: MagicMock, _mock_which: MagicMock
    ) -> None:
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
    def test_returns_default_on_failure(
        self, mock_run: MagicMock, _mock_which: MagicMock
    ) -> None:
        mock_run.return_value = MagicMock(returncode=1, stdout="")
        assert buildkite.get_metadata("key", "default") == "default"

    @patch("shutil.which", return_value=None)
    def test_returns_empty_string_default(self, _mock: MagicMock) -> None:
        assert buildkite.get_metadata("key") == ""


class TestSetMetadata:
    @patch("shutil.which", return_value=None)
    def test_noop_when_no_agent(self, _mock: MagicMock) -> None:
        buildkite.set_metadata("key", "value")

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_calls_with_check_true(
        self, mock_run: MagicMock, _mock_which: MagicMock
    ) -> None:
        buildkite.set_metadata("key", "value")
        mock_run.assert_called_once_with(
            ["buildkite-agent", "meta-data", "set", "key", "value"],
            check=True,
        )

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run", side_effect=subprocess.CalledProcessError(1, "cmd"))
    def test_raises_on_failure(
        self, _mock_run: MagicMock, _mock_which: MagicMock
    ) -> None:
        with pytest.raises(subprocess.CalledProcessError):
            buildkite.set_metadata("key", "value")


class TestAnnotate:
    @patch("shutil.which", return_value=None)
    def test_noop_when_no_agent(self, _mock: MagicMock) -> None:
        buildkite.annotate("msg")

    @patch("shutil.which", return_value="/usr/bin/buildkite-agent")
    @patch("subprocess.run")
    def test_calls_annotate(
        self, mock_run: MagicMock, _mock_which: MagicMock
    ) -> None:
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
    def test_default_style_and_context(
        self, mock_run: MagicMock, _mock_which: MagicMock
    ) -> None:
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
