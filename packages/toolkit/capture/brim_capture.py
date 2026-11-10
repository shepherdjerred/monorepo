"""Brim capture: an observe-only mitmproxy addon.

It records the raw inference requests and responses coding-agent CLIs send, as
one JSON line per HTTP flow or WebSocket message in a 0600 spool that the
toolkit history daemon ingests. The record contract is
``packages/toolkit/schemas/brim-capture-flow.schema.json``.

Rules:

- Only routes from ``brim_capture_routes`` (host, method, path regex,
  WebSocket or not) are recorded; every other flow on an intercepted host
  passes through untouched and unrecorded.
- Credential headers are dropped before anything is serialized.
- Streamed responses are teed through ``flow.response.stream`` so the CLI is
  never buffered.
- The addon never modifies, blocks, or replays a flow.

``brim capture run`` writes this file from the copy embedded in the toolkit
binary and passes both options on the mitmdump command line.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mitmproxy import ctx, http
from mitmproxy.net import encoding

RECORD_VERSION = 1
SEGMENT_MAX_BYTES = 8 * 1024 * 1024
SEGMENT_MAX_AGE_SECONDS = 10.0
OPEN_SUFFIX = ".jsonl.part"
CLOSED_SUFFIX = ".jsonl"

EXACT_SENSITIVE_HEADERS = frozenset({"authorization", "x-api-key", "cookie", "set-cookie"})
SENSITIVE_HEADER_PARTS = ("token", "key", "secret", "auth", "cookie")


def is_sensitive_header(name: str) -> bool:
    lowered = name.lower()
    return lowered in EXACT_SENSITIVE_HEADERS or any(part in lowered for part in SENSITIVE_HEADER_PARTS)


def safe_headers(headers: http.Headers) -> list[list[str]]:
    return [[name, value] for name, value in headers.items(multi=True) if not is_sensitive_header(name)]


def iso(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    moment = datetime.fromtimestamp(timestamp, tz=UTC)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def encode_body(data: bytes | None) -> dict[str, str] | None:
    if data is None:
        return None
    try:
        return {"text": data.decode("utf-8")}
    except UnicodeDecodeError:
        return {"base64": base64.b64encode(data).decode("ascii")}


def decoded(data: bytes, content_encoding: str | None) -> bytes:
    if not content_encoding or content_encoding.lower() == "identity":
        return data
    try:
        return encoding.decode(data, content_encoding)
    except ValueError:
        # Unknown or corrupt encoding: keep the raw bytes; ingest records
        # them as an undecodable body rather than guessing.
        return data


class Route:
    def __init__(self, spec: dict[str, Any]) -> None:
        self.cli = str(spec["cli"])
        self.host = str(spec["host"]).lower()
        self.methods = frozenset(str(method).upper() for method in spec["methods"])
        self.path = re.compile(str(spec["path"]))
        self.websocket = bool(spec["websocket"])

    def matches(self, flow: http.HTTPFlow, websocket: bool) -> bool:
        request = flow.request
        return (
            self.websocket == websocket
            and request.host.lower() == self.host
            and request.method.upper() in self.methods
            and self.path.search(request.path) is not None
        )


class Spool:
    """Appends records to 0600 segments; a closed segment is ingestible."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.sequence = 0
        self.fd: int | None = None
        self.path: Path | None = None
        self.opened_at = 0.0
        self.size = 0

    def write(self, record: dict[str, Any]) -> None:
        line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        if self.fd is None:
            self._open()
        assert self.fd is not None
        os.write(self.fd, line)
        self.size += len(line)
        if self.size >= SEGMENT_MAX_BYTES:
            self.close()

    def rotate_if_stale(self) -> None:
        if self.fd is not None and time.monotonic() - self.opened_at >= SEGMENT_MAX_AGE_SECONDS:
            self.close()

    def close(self) -> None:
        if self.fd is None or self.path is None:
            return
        os.close(self.fd)
        closed = self.path.with_name(self.path.name.removesuffix(OPEN_SUFFIX) + CLOSED_SUFFIX)
        os.replace(self.path, closed)
        self.fd = None
        self.path = None

    def close_orphans(self) -> None:
        """Closes segments a crashed proxy left open; ingest drops a torn last line."""
        for orphan in self.directory.glob(f"*{OPEN_SUFFIX}"):
            pid = orphan.name.split("-")[1] if orphan.name.count("-") >= 2 else ""
            if pid.isdigit() and int(pid) != os.getpid() and not pid_alive(int(pid)):
                os.replace(orphan, orphan.with_name(orphan.name.removesuffix(OPEN_SUFFIX) + CLOSED_SUFFIX))

    def _open(self) -> None:
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        self.sequence += 1
        name = f"{int(time.time() * 1000):013d}-{os.getpid()}-{self.sequence:06d}{OPEN_SUFFIX}"
        self.path = self.directory / name
        self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_EXCL, 0o600)
        self.opened_at = time.monotonic()
        self.size = 0


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class BrimCapture:
    def __init__(self) -> None:
        self.routes: list[Route] = []
        self.spool: Spool | None = None
        self.recorded: dict[str, Route] = {}
        self.chunks: dict[str, list[bytes]] = {}
        self.ws_seq: dict[str, int] = {}
        self.rotation: asyncio.Task[None] | None = None

    def load(self, loader: Any) -> None:
        loader.add_option("brim_capture_spool", str, "", "Directory for capture spool segments.")
        loader.add_option("brim_capture_routes", str, "[]", "JSON list of recorded routes.")

    def configure(self, updated: set[str]) -> None:
        if "brim_capture_routes" in updated:
            self.routes = [Route(spec) for spec in json.loads(ctx.options.brim_capture_routes)]
        if "brim_capture_spool" in updated and ctx.options.brim_capture_spool:
            if self.spool is not None:
                self.spool.close()
            self.spool = Spool(Path(ctx.options.brim_capture_spool))
            self.spool.close_orphans()

    async def running(self) -> None:
        self.rotation = asyncio.create_task(self._rotate_forever())

    def done(self) -> None:
        if self.rotation is not None:
            self.rotation.cancel()
        if self.spool is not None:
            self.spool.close()

    async def _rotate_forever(self) -> None:
        while True:
            await asyncio.sleep(1)
            if self.spool is not None:
                self.spool.rotate_if_stale()

    def _route(self, flow: http.HTTPFlow, websocket: bool) -> Route | None:
        return next((route for route in self.routes if route.matches(flow, websocket)), None)

    def _write(self, record: dict[str, Any]) -> None:
        if self.spool is None:
            raise RuntimeError("brim_capture_spool is not set")
        self.spool.write(record)

    def _base(self, flow: http.HTTPFlow, route: Route) -> dict[str, Any]:
        return {
            "v": RECORD_VERSION,
            "id": flow.id,
            "connectionId": flow.client_conn.id,
            "cli": route.cli,
            "host": flow.request.host,
            "port": flow.request.port,
            "path": flow.request.path,
        }

    def requestheaders(self, flow: http.HTTPFlow) -> None:
        is_upgrade = flow.request.headers.get("upgrade", "").lower() == "websocket"
        route = self._route(flow, is_upgrade)
        if route is not None:
            self.recorded[flow.id] = route

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        if flow.id not in self.recorded or flow.response is None or flow.response.status_code == 101:
            return
        chunks: list[bytes] = []
        self.chunks[flow.id] = chunks

        def tee(data: bytes) -> bytes:
            chunks.append(data)
            return data

        flow.response.stream = tee

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.websocket is not None:
            return
        self._finish(flow, None)

    def error(self, flow: http.HTTPFlow) -> None:
        if flow.websocket is not None:
            return
        self._finish(flow, flow.error.msg if flow.error else "unknown error")

    def _finish(self, flow: http.HTTPFlow, error: str | None) -> None:
        route = self.recorded.pop(flow.id, None)
        chunks = self.chunks.pop(flow.id, None)
        if route is None:
            return
        response = flow.response
        response_record = None
        if response is not None:
            raw = b"".join(chunks) if chunks is not None else response.raw_content
            body = None if raw is None else decoded(raw, response.headers.get("content-encoding"))
            response_record = {
                "status": response.status_code,
                "headers": safe_headers(response.headers),
                "body": encode_body(body),
                "streamed": chunks is not None,
            }
        self._write(
            {
                **self._base(flow, route),
                "kind": "http",
                "method": flow.request.method,
                "startedAt": iso(flow.request.timestamp_start),
                "endedAt": iso(response.timestamp_end if response is not None else None),
                "request": {
                    "headers": safe_headers(flow.request.headers),
                    "body": encode_body(flow.request.get_content(strict=False)),
                },
                "response": response_record,
                "error": error,
            }
        )

    def websocket_start(self, flow: http.HTTPFlow) -> None:
        route = self.recorded.get(flow.id)
        if route is None:
            return
        self.ws_seq[flow.id] = 0
        self._write(
            {
                **self._base(flow, route),
                "kind": "ws-open",
                "at": iso(time.time()),
                "requestHeaders": safe_headers(flow.request.headers),
                "responseHeaders": safe_headers(flow.response.headers) if flow.response else [],
            }
        )

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        if flow.id not in self.recorded or flow.websocket is None:
            return
        message = flow.websocket.messages[-1]
        seq = self.ws_seq.get(flow.id, 0)
        self.ws_seq[flow.id] = seq + 1
        body = {"text": message.text} if message.is_text else encode_body(message.content)
        self._write(
            {
                "v": RECORD_VERSION,
                "kind": "ws-message",
                "id": flow.id,
                "seq": seq,
                "at": iso(message.timestamp),
                "fromClient": message.from_client,
                "body": body,
            }
        )

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        if self.recorded.pop(flow.id, None) is None:
            return
        self.ws_seq.pop(flow.id, None)
        websocket = flow.websocket
        self._write(
            {
                "v": RECORD_VERSION,
                "kind": "ws-close",
                "id": flow.id,
                "at": iso(time.time()),
                "code": websocket.close_code if websocket is not None else None,
                "reason": (websocket.close_reason or None) if websocket is not None else None,
            }
        )


addons = [BrimCapture()]
