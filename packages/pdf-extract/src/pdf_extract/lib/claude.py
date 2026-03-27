"""Claude VLM client (Sonnet + Opus) with retry, concurrency, and metrics."""
from __future__ import annotations

import asyncio
import base64
import time
from typing import TYPE_CHECKING, Any

import anthropic
from anthropic import APIStatusError, RateLimitError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("claude")

_DEFAULT_RETRY = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((RateLimitError, APIStatusError)),
)


class ClaudeClient:
    """Claude VLM client implementing VisionExtractor protocol.

    Supports both Sonnet and Opus models with separate metrics tracking.
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        max_concurrent: int = 5,
        metrics: PipelineMetrics | None = None,
    ) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model
        self._sem = asyncio.Semaphore(max_concurrent)
        self._metrics = metrics

    def _is_opus(self) -> bool:
        return "opus" in self._model.lower()

    def _track(self, usage: anthropic.types.Usage, duration_ms: float) -> None:
        if not self._metrics:
            return
        api = self._metrics.api
        if self._is_opus():
            api.claude_opus_calls += 1
            api.claude_opus_input_tokens += usage.input_tokens
            api.claude_opus_output_tokens += usage.output_tokens
        else:
            api.claude_sonnet_calls += 1
            api.claude_sonnet_input_tokens += usage.input_tokens
            api.claude_sonnet_output_tokens += usage.output_tokens
        log.debug(
            "claude_request",
            model=self._model,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            duration_ms=round(duration_ms, 1),
        )

    def _track_error(self) -> None:
        if not self._metrics:
            return
        api = self._metrics.api
        if self._is_opus():
            api.claude_opus_errors += 1
        else:
            api.claude_sonnet_errors += 1
        api.total_errors += 1

    def _build_content(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = []
        if image_bytes is not None:
            img_b64 = base64.b64encode(image_bytes).decode()
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image_mime,
                    "data": img_b64,
                },
            })
        content.append({"type": "text", "text": prompt})
        return content

    def _build_multi_image_content(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
    ) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = []
        for img_bytes, mime in images:
            img_b64 = base64.b64encode(img_bytes).decode()
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime,
                    "data": img_b64,
                },
            })
        content.append({"type": "text", "text": prompt})
        return content

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> str:
        """Generate a response with optional image. Retries on rate limit/server errors."""
        content = self._build_content(prompt, image_bytes, image_mime)

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await self._client.messages.create(
                    model=self._model,
                    max_tokens=4096,
                    messages=[{"role": "user", "content": content}],  # type: ignore[typeddict-item]
                )
            except (RateLimitError, APIStatusError):
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp.usage, duration_ms)
            block = resp.content[0] if resp.content else None
            return block.text if block and hasattr(block, "text") else ""

    async def generate_multi_image(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
    ) -> str:
        """Generate a response with multiple images."""
        content = self._build_multi_image_content(prompt, images)

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await self._client.messages.create(
                    model=self._model,
                    max_tokens=4096,
                    messages=[{"role": "user", "content": content}],  # type: ignore[typeddict-item]
                )
            except (RateLimitError, APIStatusError):
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp.usage, duration_ms)
            block = resp.content[0] if resp.content else None
            return block.text if block and hasattr(block, "text") else ""
