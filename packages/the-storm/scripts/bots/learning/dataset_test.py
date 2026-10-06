"""Meaningful data gates: leakage, provenance, alignment and recurrent resets."""

import unittest
from io import StringIO

from dataset import Controls, action, action_counts, features, read, sequences, split_matches


def fixture(inputs: list[str]) -> str:
    values = [0.0] * len(features())
    values[features().index("HP")] = 1
    values[features().index("TARGET_KNOWN")] = 1
    values[features().index("SLOT")] = 1 / 8
    obs = "\t".join(str(value) for value in values)
    rows = ["H\t3\t00000000-0000-0000-0000-000000000001\tyard\tsha\t42\trules",
            "R\tp1\tRED\ttrooper\tfalse", "R\tp2\tBLUE\ttrooper\ttrue"]
    for tick in range(12):
        rows.append(f"O\t{tick}\tp1\trwf-combat-v1\t{obs}")
        rows.append(f"F\t{tick}\tp1\t0\t0\t0\t0\t0\t80\t1\t0")
    return "\n".join(rows + inputs + ["X\t12\tRED\tLAST_TEAM_STANDING"]) + "\n"


def human(tick: int, sequence: int | None = None, ack: int | None = None) -> str:
    return (f"N\t{tick}\tp1\t65\t0\t0\ttrue\tfalse\t1\t"
            f"{tick if sequence is None else sequence}\t{tick if ack is None else ack}\tHUMAN")


class DatasetTest(unittest.TestCase):
    def test_action_coverage_counts_only_accepted_human_samples(self) -> None:
        text = fixture([human(0), human(1), human(2).replace("\tHUMAN", "\tAUTOMATED"),
                        human(3).replace("\t65\t", "\t0\t").replace("\ttrue\tfalse", "\tfalse\tfalse"),
                        human(4).replace("\t65\t", "\t0\t").replace("\ttrue\tfalse", "\tfalse\tfalse")])
        chunks, _ = sequences(read(StringIO(text)))
        counts = action_counts(chunks)
        self.assertEqual(counts["attack"], {"0": 2, "1": 2})
        self.assertEqual(counts["move"]["4"], 2)
        self.assertEqual(counts["move"]["7"], 2)
        self.assertEqual(sum(counts["move"].values()), 4)

    def test_gaps_automation_and_stale_observations_reset_sequences(self) -> None:
        record = read(StringIO(fixture([
            human(0), human(1),
            "N\t2\tp1\t65\t0\t0\ttrue\tfalse\t0\t2\t2\tAUTOMATED",
            human(3), human(4),
            "N\t5\tp1\t0\t0\t0\tfalse\tfalse\t0\t-1\t-1\tMISSING",
            human(6), human(7), human(8, ack=4), human(9), human(10),
        ])))
        chunks, counts = sequences(record)
        self.assertEqual([[sample["tick"] for sample in chunk["samples"]] for chunk in chunks],
                         [[0, 1], [3, 4], [6, 7], [9, 10]])
        self.assertEqual(counts["accepted"], 8)
        self.assertEqual(counts["automated"], 1)
        self.assertEqual(counts["missing"], 1)
        self.assertEqual(counts["stale_or_unacknowledged"], 1)

    def test_packet_sequence_loss_is_not_interpolated(self) -> None:
        record = read(StringIO(fixture([human(0), human(1), human(2, 4), human(3, 5)])))
        chunks, counts = sequences(record)
        self.assertEqual([len(chunk["samples"]) for chunk in chunks], [2, 2])
        self.assertEqual(counts["sequence_breaks"], 1)

    def test_missing_samples_cannot_hide_a_replayed_packet_sequence(self) -> None:
        text = fixture([human(0),
                        "N\t1\tp1\t0\t0\t0\tfalse\tfalse\t1\t-1\t-1\tMISSING",
                        human(2, 0)])
        with self.assertRaises(ValueError):
            read(StringIO(text))

    def test_alignment_uses_acknowledged_observation_and_client_yaw(self) -> None:
        row = human(2, ack=0).replace("\t65\t0\t0\t", "\t65\t9000\t0\t")
        control = Controls.parse(row.split("\t"))
        self.assertEqual(action(control, 0),
                         {"move": 5, "jump": 0, "sneak": 0, "sprint": 1, "attack": 1})
        self.assertEqual(action(control, 64)["move"], 7)

    def test_camera_turns_preserve_world_movement_in_minecraft_coordinates(self) -> None:
        # At yaw 0 forward is +Z and right is -X. At yaw 90 forward is -X
        # and right is -Z; the same vectors must survive the observation basis.
        for keys, yaw, observed_yaw, move in (
            (1, 9000, 0, 5), (8, 9000, 0, 1),
            (1, 27000, 0, 3), (8, 27000, 0, 7),
            (1, 0, 128, 1), (8, 0, 128, 3),
        ):
            with self.subTest(keys=keys, yaw=yaw, observed_yaw=observed_yaw):
                control = Controls(0, "p1", keys, yaw, 0, False, False, 1, 0, 0, "HUMAN")
                self.assertEqual(action(control, observed_yaw)["move"], move)

    def test_corrupt_contract_and_old_recordings_fail_loudly(self) -> None:
        text = fixture([human(0), human(1)])
        for corrupt in (text.replace("rwf-combat-v1", "rwf-other"),
                        text.replace("H\t3\t", "H\t2\t"),
                        text.replace("rwf-combat-v1\t1\t", "rwf-combat-v1\tnan\t"),
                        text + human(1) + "\n",
                        text.replace("\tHUMAN", "\tALIEN")):
            with self.subTest(corrupt=corrupt[:50]), self.assertRaises(ValueError):
                read(StringIO(corrupt))

    def test_split_is_deterministic_and_keeps_whole_matches_together(self) -> None:
        matches = [str(index) for index in range(20)]
        split = split_matches(matches, 17)
        self.assertEqual(split, split_matches(list(reversed(matches)), 17))
        self.assertEqual(list(split.values()).count("train"), 16)
        self.assertEqual(list(split.values()).count("validation"), 2)
        self.assertEqual(list(split.values()).count("test"), 2)
        with self.assertRaises(ValueError):
            split_matches(matches[:9], 17)
        with self.assertRaises(ValueError):
            split_matches([*matches, matches[0]], 17)

    def test_healing_and_non_duel_recordings_are_not_pilot_labels(self) -> None:
        text = fixture([human(0), human(1)]).replace("\ttrue\tfalse\t1\t", "\ttrue\ttrue\t2\t")
        chunks, counts = sequences(read(StringIO(text)))
        self.assertEqual(chunks, [])
        self.assertEqual(counts["authored_item_action"], 2)
        chunks, counts = sequences(read(StringIO(fixture([human(0), human(1)]))), combatants=8)
        self.assertEqual(chunks, [])
        self.assertEqual(counts["wrong_match_size"], 2)


if __name__ == "__main__":
    unittest.main()
