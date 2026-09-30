"""Consumed subset of Bazarr 1.6.0's vendored Language API."""

from babelfish import Country

class Language:
    alpha3: str
    country: Country | None
    def __init__(self, language: str, country: str | None = ..., script: str | None = ...) -> None: ...
    def add(self, other: Language) -> Language: ...
    def __hash__(self) -> int: ...
