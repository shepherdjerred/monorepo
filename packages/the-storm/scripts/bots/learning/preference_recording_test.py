"""Preference recording validation uses the same strict reader as demonstrations."""

import gzip
import tempfile
import unittest
from pathlib import Path

from preference_recording import inspect


class PreferenceRecordingTest(unittest.TestCase):
    def test_complete_native_duels_and_rejected_humans_gaps_and_wrong_maps(self) -> None:
        text = (
            f"H\t3\t00000000-0000-4000-8000-000000000000\ttraining-yard\t{'a' * 64}\t-42\trwf-combat-1\n"
            "R\tr\tRED\ttrooper\ttrue\nR\tb\tBLUE\ttrooper\ttrue\n"
            "F\t0\tr\t0\t0\t0\t0\t0\t80\t1\t0\nF\t2\tr\t0\t0\t0\t0\t0\t80\t1\t0\n"
            "F\t0\tb\t0\t0\t0\t0\t0\t80\t1\t0\nF\t2\tb\t0\t0\t0\t0\t0\t80\t1\t0\n"
            "X\t3\tRED\tLAST_TEAM_STANDING\n"
        )
        with tempfile.TemporaryDirectory(prefix="rwf-preference-unit-") as directory:
            file = Path(directory) / "unit.rwfrec.gz"
            with gzip.open(file, "wt", encoding="utf-8") as stream:
                stream.write(text)
            self.assertEqual(inspect(file)["winner"], "RED")
            self.assertEqual(inspect(file, -42)["winner"], "RED")
            with self.assertRaisesRegex(ValueError, "domain seed"):
                inspect(file, 42)
            for altered in (
                text.replace("\t-42\t", "\t9223372036854775808\t"),
                text.replace("training-yard", "other-map"),
                text.replace("trooper\ttrue", "trooper\tfalse"),
                text.replace("X\t3\tRED\tLAST_TEAM_STANDING\n", ""),
                text.replace("LAST_TEAM_STANDING", "unknown"),
                text.replace("LAST_TEAM_STANDING", "DRAW"),
                text.replace("F\t2\tb\t0\t0\t0\t0\t0\t80\t1\t0\n", ""),
            ):
                with gzip.open(file, "wt", encoding="utf-8") as stream:
                    stream.write(altered)
                with self.assertRaises(ValueError):
                    inspect(file)


if __name__ == "__main__":
    unittest.main()
