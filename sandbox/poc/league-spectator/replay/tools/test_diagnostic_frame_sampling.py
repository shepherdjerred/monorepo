import math
import unittest
from diagnostic_frame_sampling import select_diagnostic_frames


class DiagnosticFrameSamplingTests(unittest.TestCase):
    def test_short_histories_keep_every_frame(self):
        for count in range(1, 13):
            self.assertEqual(select_diagnostic_frames([0] * count), list(range(count)))

    def test_long_histories_keep_time_coverage_and_two_narrow_positive_peaks(self):
        scores = [0] * 120
        scores[4], scores[57] = 10, 20
        selected = select_diagnostic_frames(scores)
        self.assertEqual(len(selected), 12)
        self.assertEqual(selected[0], 0)
        self.assertEqual(selected[-1], 119)
        self.assertIn(4, selected)
        self.assertIn(57, selected)
        self.assertEqual(selected, sorted(set(selected)))
        self.assertEqual(select_diagnostic_frames(scores), selected)
        self.assertEqual(scores[57], 20)

    def test_zero_area_has_no_invented_positive_peak_and_ties_are_stable(self):
        zero = select_diagnostic_frames([0] * 120)
        self.assertEqual(len(zero), 10)
        tied = select_diagnostic_frames([1] * 120)
        additions = sorted(set(tied) - set(zero))
        self.assertEqual(additions, [index for index in range(120) if index not in zero][:2])

    def test_invalid_scores_fail_before_selection(self):
        for scores in [[], None, [math.nan], [math.inf], [-1], [True], ['1']]:
            with self.assertRaises(ValueError):
                select_diagnostic_frames(scores)


if __name__ == '__main__':
    unittest.main()
