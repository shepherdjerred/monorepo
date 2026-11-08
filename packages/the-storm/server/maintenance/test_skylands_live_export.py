import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

SOURCE = Path(__file__).resolve().parents[2] / "tools/skylands/export-live.py"
SPEC = importlib.util.spec_from_file_location("skylands_live_export", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Export tool is missing")
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


class SkylandsLiveExportTest(unittest.TestCase):
    def test_stream_failure_restores_saving(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "export"
            responses = [
                "There are 0 of a max of 20 players online:",
                "Automatic saving is now disabled",
                "Saved the game",
                "Automatic saving is now enabled",
            ]
            with (
                patch.object(EXPORT, "console", side_effect=responses) as console,
                patch.object(EXPORT.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "stream")),
                self.assertRaises(subprocess.CalledProcessError),
            ):
                EXPORT.main(output)
            self.assertEqual(
                console.call_args_list, [call("list"), call("save-off"), call("save-all flush"), call("save-on")]
            )

    def test_preexisting_save_hold_is_left_alone(self):
        with tempfile.TemporaryDirectory() as temporary:
            responses = ["There are 0 of a max of 20 players online:", "Saving is already turned off"]
            with (
                patch.object(EXPORT, "console", side_effect=responses) as console,
                self.assertRaisesRegex(ValueError, "already disabled"),
            ):
                EXPORT.main(Path(temporary) / "export")
            self.assertEqual(console.call_args_list, [call("list"), call("save-off")])

    def test_connected_players_prevent_any_save_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "export"
            with (
                patch.object(EXPORT, "console", return_value="There are 1 of a max of 20 players online:") as console,
                self.assertRaisesRegex(ValueError, "no connected players"),
            ):
                EXPORT.main(output)
            console.assert_called_once_with("list")
            self.assertFalse(output.exists())
