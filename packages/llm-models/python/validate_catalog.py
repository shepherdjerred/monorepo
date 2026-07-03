#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pydantic>=2.0",
# ]
# ///
"""Validate catalog.json with Pydantic — the Python view of the shared LLM model catalog.

This proves the language-neutral JSON is consumable from Python. Other Python
tools (e.g. scout's ai_analyze_llm.py) can import these models or copy the
loader. Run: `uv run packages/llm-models/python/validate_catalog.py`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field, TypeAdapter

CATALOG_PATH = Path(__file__).resolve().parent.parent / "src" / "catalog.json"


class TextPricing(BaseModel):
    model_config = {"extra": "forbid"}
    modality: Literal["text"]
    input: float = Field(ge=0)
    output: float = Field(ge=0)
    cachedInput: Optional[float] = Field(default=None, ge=0)
    cacheRead: Optional[float] = Field(default=None, ge=0)
    cacheWrite: Optional[float] = Field(default=None, ge=0)


class ImagePricing(BaseModel):
    model_config = {"extra": "forbid"}
    modality: Literal["image"]
    perImage: float = Field(ge=0)


Pricing = Annotated[TextPricing | ImagePricing, Field(discriminator="modality")]


class Capabilities(BaseModel):
    model_config = {"extra": "forbid"}
    supportsTemperature: bool
    supportsTopP: bool
    maxTokens: Optional[int] = Field(default=None, gt=0)
    adaptiveThinking: Optional[bool] = None
    effortTiers: Optional[list[str]] = None


class ModelEntry(BaseModel):
    model_config = {"extra": "forbid"}
    id: str = Field(min_length=1)
    provider: Literal["openai", "anthropic", "google"]
    displayName: str = Field(min_length=1)
    description: Optional[str] = None
    pricing: Pricing
    contextWindow: Optional[int] = Field(default=None, gt=0)
    pinnedContextWindow: Optional[bool] = None
    capabilities: Capabilities
    status: Literal["current", "preview", "deprecated"]
    category: Optional[str] = None


CatalogAdapter = TypeAdapter(dict[str, ModelEntry])


def load_catalog(path: Path = CATALOG_PATH) -> dict[str, ModelEntry]:
    """Load and validate the catalog. Raises on malformed data or key/id mismatch."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    catalog = CatalogAdapter.validate_python(raw)
    for key, entry in catalog.items():
        if key != entry.id:
            raise ValueError(f"catalog key {key!r} != entry.id {entry.id!r}")
    return catalog


def main() -> int:
    catalog = load_catalog()
    by_provider: dict[str, int] = {}
    for entry in catalog.values():
        by_provider[entry.provider] = by_provider.get(entry.provider, 0) + 1
    print(f"OK: {len(catalog)} models validated from {CATALOG_PATH}")
    for provider in sorted(by_provider):
        print(f"  {provider}: {by_provider[provider]}")
    if not {"openai", "anthropic", "google"}.issubset(by_provider):
        print("ERROR: not all three providers are represented", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
