from collections.abc import Mapping

from subliminal.video import Video
from subzero.language import Language

class Subtitle:
    language: Language
    page_link: str
    content: bytes | None
    hearing_impaired: bool
    encoding: str | None
    def __init__(self, language: Language, *, page_link: str) -> None: ...
    @property
    def id(self) -> str: ...
    def get_matches(self, video: Video) -> set[str]: ...

def guess_matches(video: Video, guess: Mapping[str, object]) -> set[str]: ...
