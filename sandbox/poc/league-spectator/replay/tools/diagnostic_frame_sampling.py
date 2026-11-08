"""Bound isolated diagnostic raster work without changing playback packets."""
import math

POLICY = 'isolated-component-first-last-eight-interior-two-positive-area-peaks-v1'


def select_diagnostic_frames(scores):
    """Return <=12 ordered indices, keeping endpoints and deterministic peaks.

    Scores describe projected colored triangle area, not observed GPU pixels.
    Selection never establishes visibility and never filters runtime events.
    """
    if not isinstance(scores, list) or not scores:
        raise ValueError('A nonempty ordered diagnostic component history is required')
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or
           not math.isfinite(value) or value < 0 for value in scores):
        raise ValueError('Finite nonnegative diagnostic area scores required')
    count = len(scores)
    if count <= 12:
        return list(range(count))
    selected = {0, count - 1}
    selected.update((index * (count - 1) + 4) // 9 for index in range(1, 9))
    peaks = sorted(range(count), key=lambda index: (-scores[index], index))
    added = 0
    for index in peaks:
        if scores[index] <= 0 or added == 2:
            break
        if index not in selected:
            selected.add(index)
            added += 1
    return sorted(selected)
