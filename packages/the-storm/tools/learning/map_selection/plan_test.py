"""Map plans are provenance contracts; test data here never enters training."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_selection.plan import MapBinding, read_maps, rollout_map


class MapsTest(unittest.TestCase):
    def test_rollouts_pair_sides_cover_every_map_and_repeat_without_changing_identity(self) -> None:
        maps = [MapBinding("isles", "a" * 64, "b" * 64), MapBinding("yard", "c" * 64, "d" * 64)]
        selected = [rollout_map(maps, index) for index in range(8)]
        self.assertEqual(selected, [maps[0], maps[0], maps[1], maps[1]] * 2)
        for index in (0, 2):
            self.assertEqual(selected[index], selected[index + 1])
        for count in (-1, True):
            with self.subTest(count=count), self.assertRaises(ValueError):
                rollout_map(maps, count)
        with self.assertRaises(ValueError):
            rollout_map([], 0)

    def test_rejects_empty_reordered_duplicate_or_corrupt_plan_instead_of_falling_back(
        self,
    ) -> None:
        one = MapBinding("isles", "a" * 64, "b" * 64).report()
        two = MapBinding("yard", "c" * 64, "d" * 64).report()
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / "training-maps.json"
            envelope: dict[str, object] = {
                "schema": 1,
                "kind": "rwf-training-maps",
                "maps": [one, two],
            }
            file.write_text(json.dumps(envelope), encoding="utf-8")
            self.assertEqual(read_maps(file), [MapBinding.parse(one), MapBinding.parse(two)])
            for changed in (
                {"maps": []},
                {"maps": [two, one]},
                {"maps": [one, one]},
                {"maps": [{**one, "map": "../outside"}]},
                {"maps": [{**one, "scenarioSha256": "incorrect"}]},
                {"maps": [{**one, "ignored": True}]},
                {"schema": True},
                {"extra": True},
            ):
                file.write_text(json.dumps({**envelope, **changed}), encoding="utf-8")
                with self.subTest(changed=changed), self.assertRaises(ValueError):
                    read_maps(file)


if __name__ == "__main__":
    unittest.main()
