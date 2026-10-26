"""Strict types for the one-time maintenance plan and receipts."""

import json
from collections.abc import Mapping
from typing import cast


class JsonObject(dict[str, object]):
    @classmethod
    def parse(cls, encoded: str | bytes) -> "JsonObject":
        return cls.require(json.loads(encoded))

    @classmethod
    def require(cls, value: object) -> "JsonObject":
        if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
            raise ValueError("Expected a JSON object with string keys")
        return value if isinstance(value, cls) else cls(value)

    def object(self, key: str) -> "JsonObject":
        result = self.require(self[key])
        self[key] = result
        return result

    def string(self, key: str) -> str:
        value = self[key]
        if not isinstance(value, str):
            raise ValueError("Expected a string at JSON key: " + key)
        return value

    def integer(self, key: str) -> int:
        value = self[key]
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("Expected an integer at JSON key: " + key)
        return value

    def objects(self, key: str) -> list["JsonObject"]:
        value = self[key]
        if not isinstance(value, list):
            raise ValueError("Expected an object array at JSON key: " + key)
        result = [self.require(item) for item in value]
        self[key] = result
        return result

    def strings(self, key: str) -> dict[str, str]:
        value = self[key]
        if not isinstance(value, Mapping) or any(
            not isinstance(name, str) or not isinstance(item, str) for name, item in value.items()
        ):
            raise ValueError("Expected string values at JSON key: " + key)
        return cast(dict[str, str], value)

    def string_list(self, key: str) -> list[str]:
        value = self[key]
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise ValueError("Expected a string array at JSON key: " + key)
        return cast(list[str], value)
