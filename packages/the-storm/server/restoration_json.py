"""Typed, fail-closed access to operator journals and Kubernetes JSON responses."""

import builtins
import json
from collections.abc import Mapping
from typing import cast


class JsonObject(dict[str, object]):
    """JSON keys are read with their required type before they can drive an operation."""

    @classmethod
    def parse(cls, encoded: str | bytes) -> "JsonObject":
        value: object = json.loads(encoded)
        return cls.require(value)

    @classmethod
    def require(cls, value: object) -> "JsonObject":
        if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
            raise ValueError("Expected a JSON object with string keys")
        return value if isinstance(value, cls) else cls(value)

    def object(self, key: str, default: Mapping[str, object] | None = None) -> "JsonObject":
        value = self.get(key, default)
        result = self.require(value)
        self[key] = result
        return result

    def string(self, key: str, default: str | None = None) -> str:
        value = self.get(key, default)
        if not isinstance(value, str):
            raise ValueError("Expected a string at JSON key: " + key)
        return value

    def integer(self, key: str) -> int:
        value = self[key]
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("Expected an integer at JSON key: " + key)
        return value

    def objects(self, key: str, default: list[builtins.object] | None = None) -> list["JsonObject"]:
        value = self.get(key, default)
        if not isinstance(value, list):
            raise ValueError("Expected an object array at JSON key: " + key)
        result = [self.require(item) for item in value]
        self[key] = result
        return result

    def strings(self, key: str, default: Mapping[str, str] | None = None) -> dict[str, str]:
        value = self.get(key, default)
        if not isinstance(value, dict) or any(
            not isinstance(name, str) or not isinstance(item, str) for name, item in value.items()
        ):
            raise ValueError("Expected string values at JSON key: " + key)
        # Every key and value was checked above. Preserve the mutable dictionary
        # so journal updates and compare-and-swap input retain the same identity.
        self[key] = value
        return cast(dict[str, str], value)

    def string_list(self, key: str) -> list[str]:
        value = self[key]
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise ValueError("Expected a string array at JSON key: " + key)
        return cast(list[str], value)
