"""VisionExtractor protocol — common interface for all VLM providers."""
from __future__ import annotations

from typing import Protocol


class VisionExtractor(Protocol):
    """Common interface for all VLM providers.

    Each provider implements generate() for single-image calls and
    generate_multi_image() for batched multi-image calls (e.g. handwriting
    detection across all pages).
    """

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> str: ...

    async def generate_multi_image(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
    ) -> str: ...
