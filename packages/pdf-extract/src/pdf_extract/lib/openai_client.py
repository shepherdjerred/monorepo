"""OpenAI GPT-4o VLM client with retry, concurrency, and metrics."""
from __future__ import annotations

import asyncio
import base64
import time
from typing import TYPE_CHECKING, Any

from openai import AsyncOpenAI, RateLimitError

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("openai")


class OpenAIClient:
    """GPT-4o VLM client implementing VisionExtractor protocol."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-5.4",
        max_concurrent: int = 5,
        metrics: PipelineMetrics | None = None,
    ) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._sem = asyncio.Semaphore(max_concurrent)
        self._metrics = metrics

    def _track(self, usage: Any, duration_ms: float) -> None:
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
    ) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = []
        if image_bytes is not None:
            img_b64 = base64.b64encode(image_bytes).decode()
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{image_mime};base64,{img_b64}"},
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
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{img_b64}"},
            })
        content.append({"type": "text", "text": prompt})
        return content

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        image_mime: str = "image/png",
    ) -> str:
        """Generate a response with optional image. Retries on rate limit."""
        content = self._build_content(prompt, image_bytes, image_mime)

        async with self._sem:
            start = time.monotonic()
            for attempt in range(3):
                try:
                    resp = await asyncio.wait_for(
                        self._client.chat.completions.create(
                            model=self._model,
                            messages=[{"role": "user", "content": content}],  # type: ignore[misc,list-item]
                            max_tokens=4096,
                        ),
                        timeout=60.0,
                    )
                    duration_ms = (time.monotonic() - start) * 1000
                    self._track(resp.usage, duration_ms)
                    choice = resp.choices[0] if resp.choices else None
                    if choice and choice.message and choice.message.content:
                        return choice.message.content
                    return ""
                except RateLimitError:
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
        content = self._build_multi_image_content(prompt, images)

        async with self._sem:
            start = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    self._client.chat.completions.create(
                        model=self._model,
                        messages=[{"role": "user", "content": content}],  # type: ignore[misc,list-item]
                        max_tokens=4096,
                    ),
                    timeout=120.0,
                )
            except (RateLimitError, TimeoutError):
                self._track_error()
                raise
            duration_ms = (time.monotonic() - start) * 1000
            self._track(resp.usage, duration_ms)
            choice = resp.choices[0] if resp.choices else None
            if choice and choice.message and choice.message.content:
                return choice.message.content
            return ""
