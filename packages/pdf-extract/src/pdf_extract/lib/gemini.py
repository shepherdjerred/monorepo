"""Gemini VLM client with retry, concurrency control, and metrics tracking."""
from __future__ import annotations

import asyncio
import base64
import time
from typing import TYPE_CHECKING

from google import genai
from google.genai import types
from google.genai.errors import ServerError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("gemini")


def _retry_decorator() -> retry:  # type: ignore[type-arg]
    return retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((ServerError, asyncio.TimeoutError)),
    )


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

    def _track(self, resp: types.GenerateContentResponse, duration_ms: float) -> None:
        if not self._metrics:
            return
        api = self._metrics.api
        if self._is_pro():
            api.gemini_pro_calls += 1
            if resp.usage_metadata:
                api.gemini_pro_input_tokens += resp.usage_metadata.prompt_token_count or 0
                api.gemini_pro_output_tokens += resp.usage_metadata.candidates_token_count or 0
        else:
            api.gemini_calls += 1
            if resp.usage_metadata:
                api.gemini_input_tokens += resp.usage_metadata.prompt_token_count or 0
                api.gemini_output_tokens += resp.usage_metadata.candidates_token_count or 0
        log.debug("gemini_request", model=self._model, duration_ms=round(duration_ms, 1))

    def _track_error(self) -> None:
        if not self._metrics:
            return
        self._metrics.api.gemini_errors += 1
        self._metrics.api.total_errors += 1

    @_retry_decorator()
    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> str:
        parts: list[types.Part] = []
        if image_bytes is not None:
            img_b64 = base64.b64encode(image_bytes).decode()
            parts.append(
                types.Part(inline_data=types.Blob(mime_type=image_mime, data=img_b64))
            )
        parts.append(types.Part(text=prompt))

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    self._client.aio.models.generate_content(
                        model=self._model,
                        contents=[types.Content(parts=parts)],
                    ),
                    timeout=60.0,
                )
            except Exception:
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp, duration_ms)
            return resp.text or ""

    @_retry_decorator()
    async def generate_multi_image(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
    ) -> str:
        parts: list[types.Part] = []
        for img_bytes, mime in images:
            img_b64 = base64.b64encode(img_bytes).decode()
            parts.append(
                types.Part(inline_data=types.Blob(mime_type=mime, data=img_b64))
            )
        parts.append(types.Part(text=prompt))

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    self._client.aio.models.generate_content(
                        model=self._model,
                        contents=[types.Content(parts=parts)],
                    ),
                    timeout=120.0,
                )
            except Exception:
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp, duration_ms)
            return resp.text or ""
