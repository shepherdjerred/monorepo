from collections.abc import Callable
from typing import BinaryIO, Protocol

class ImagePitcher(Protocol):
    def throw(self) -> str: ...

class Pitchers:
    def get_pitcher(self, name: str) -> Callable[[str, BinaryIO], ImagePitcher]: ...

pitchers: Pitchers
