"""Gemini VLM client with retry, concurrency control, and metrics tracking."""
from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

from google import genai
from google.genai import types
from google.genai.errors import ServerError

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("gemini")


class GeminiClient:
    """Gemini VLM client implementing VisionExtractor protocol."""

    def __init__(
        self,
        api_key: str,
        model: str,
        max_concurrent: int = 10,
        metrics: PipelineMetrics | None = None,
    ) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._sem = asyncio.Semaphore(max_concurrent)
        self._metrics = metrics

    def _is_pro(self) -> bool:
        return "pro" in self._model.lower()

    def _track(self, resp: Any, duration_ms: float) -> None:
        if not self._metrics:
            return
        api = self._metrics.api
        if self._is_pro():
            api.gemini_pro_calls += 1
            if hasattr(resp, "usage_metadata") and resp.usage_metadata:
                api.gemini_pro_input_tokens += getattr(resp.usage_metadata, "prompt_token_count", 0) or 0
                api.gemini_pro_output_tokens += getattr(resp.usage_metadata, "candidates_token_count", 0) or 0
        else:
            api.gemini_calls += 1
            if hasattr(resp, "usage_metadata") and resp.usage_metadata:
                api.gemini_input_tokens += getattr(resp.usage_metadata, "prompt_token_count", 0) or 0
                api.gemini_output_tokens += getattr(resp.usage_metadata, "candidates_token_count", 0) or 0
        log.debug("gemini_request", model=self._model, duration_ms=round(duration_ms, 1))

    def _track_error(self) -> None:
        if not self._metrics:
            return
        self._metrics.api.gemini_errors += 1
        self._metrics.api.total_errors += 1

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> str:
        """Generate a response with optional image. Retries on server errors."""
        parts: list[Any] = []
        if image_bytes is not None:
            parts.append(
                types.Part(inline_data=types.Blob(mime_type=image_mime, data=image_bytes))
            )
        parts.append(types.Part(text=prompt))

        async with self._sem:
            start = time.monotonic()
            for attempt in range(3):
                try:
                    resp = await asyncio.wait_for(
                        self._client.aio.models.generate_content(
                            model=self._model,
                            contents=parts,
                        ),
                        timeout=60.0,
                    )
                    duration_ms = (time.monotonic() - start) * 1000
                    self._track(resp, duration_ms)
                    return resp.text or ""
                except ServerError:
                    self._track_error()
                    if attempt < 2:
                        await asyncio.sleep(2**attempt)
                    else:
                        raise
                except TimeoutError:
                    self._track_error()
                    if attempt < 2:
                        await asyncio.sleep(2**attempt)
                    else:
                        raise
        return ""

    async def generate_multi_image(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
    ) -> str:
        """Generate a response with multiple images."""
        parts: list[Any] = []
        for img_bytes, mime in images:
            parts.append(
                types.Part(inline_data=types.Blob(mime_type=mime, data=img_bytes))
            )
        parts.append(types.Part(text=prompt))

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    self._client.aio.models.generate_content(
                        model=self._model,
                        contents=parts,
                    ),
                    timeout=120.0,
                )
            except (ServerError, TimeoutError):
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp, duration_ms)
            return resp.text or ""
