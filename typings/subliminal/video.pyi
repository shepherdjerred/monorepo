"""Consumed subset of Bazarr 1.6.0's vendored video API."""

class Video:
    name: str
    year: int | None

class Episode(Video):
    series: str
    season: int
    episode: int
    alternative_series: list[str]
    def __init__(self, name: str, series: str, season: int, episode: int) -> None: ...
    @classmethod
    def fromname(cls, name: str) -> Episode: ...

class Movie(Video):
    title: str
    alternative_titles: list[str]
