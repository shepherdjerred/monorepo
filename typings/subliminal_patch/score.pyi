from subliminal.video import Video
from subliminal_patch.subtitle import Subtitle

MAX_SCORES: dict[str, int]

def compute_score(matches: set[str], subtitle: Subtitle, video: Video) -> tuple[int, int]: ...
