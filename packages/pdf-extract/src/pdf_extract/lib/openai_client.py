"""OpenAI GPT-4o VLM client with retry, concurrency, and metrics."""
from __future__ import annotations

import asyncio
import base64
import time
from typing import TYPE_CHECKING

from openai import AsyncOpenAI, RateLimitError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("openai")


def _retry_decorator() -> retry:  # type: ignore[type-arg]
    return retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((RateLimitError, asyncio.TimeoutError)),
    )


class OpenAIClient:
    """GPT-4o VLM client implementing VisionExtractor protocol."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o",
        max_concurrent: int = 5,
        metrics: PipelineMetrics | None = None,
    ) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._sem = asyncio.Semaphore(max_concurrent)
        self._metrics = metrics

    def _track(self, usage: object, duration_ms: float) -> None:
        if not self._metrics or usage is None:
            return
        api = self._metrics.api
        api.gpt4o_calls += 1
        prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
        completion_tokens = getattr(usage, "completion_tokens", 0) or 0
        api.gpt4o_input_tokens += prompt_tokens
        api.gpt4o_output_tokens += completion_tokens
        log.debug(
            "openai_request",
            model=self._model,
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
            duration_ms=round(duration_ms, 1),
        )

    def _track_error(self) -> None:
        if not self._metrics:
            return
        self._metrics.api.gpt4o_errors += 1
        self._metrics.api.total_errors += 1

    def _build_content(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> list[dict[str, object]]:
        content: list[dict[str, object]] = []
        if image_bytes is not None:
            img_b64 = base64.b64encode(image_bytes).decode()
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{image_mime};base64,{img_b64}",
                    },
                }
            )
        content.append({"type": "text", "text": prompt})
        return content

    def _build_multi_image_content(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
    ) -> list[dict[str, object]]:
        content: list[dict[str, object]] = []
        for img_bytes, mime in images:
            img_b64 = base64.b64encode(img_bytes).decode()
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime};base64,{img_b64}",
                    },
                }
            )
        content.append({"type": "text", "text": prompt})
        return content

    @_retry_decorator()
    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> str:
        content = self._build_content(prompt, image_bytes, image_mime)

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    self._client.chat.completions.create(
                        model=self._model,
                        messages=[{"role": "user", "content": content}],  # type: ignore[arg-type]
                        max_tokens=4096,
                    ),
                    timeout=60.0,
                )
            except RateLimitError:
                self._track_error()
                raise
            except TimeoutError:
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp.usage, duration_ms)
            choice = resp.choices[0] if resp.choices else None
            if choice and choice.message and choice.message.content:
                return choice.message.content
            return ""

    @_retry_decorator()
    async def generate_multi_image(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
    ) -> str:
        content = self._build_multi_image_content(prompt, images)

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    self._client.chat.completions.create(
                        model=self._model,
                        messages=[{"role": "user", "content": content}],  # type: ignore[arg-type]
                        max_tokens=4096,
                    ),
                    timeout=120.0,
                )
            except RateLimitError:
                self._track_error()
                raise
            except TimeoutError:
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp.usage, duration_ms)
            choice = resp.choices[0] if resp.choices else None
            if choice and choice.message and choice.message.content:
                return choice.message.content
            return ""
