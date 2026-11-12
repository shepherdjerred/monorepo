"""Tests for the observe-only capture addon.

Run from packages/toolkit (CI runs exactly this; versions match engine.ts):

    uvx --python 3.13 --with mitmproxy==12.2.1 --with jsonschema==4.25.1 pytest==8.4.2 capture
"""

from __future__ import annotations

import gzip
import json
import stat
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import brim_capture
import pytest
from jsonschema import Draft202012Validator
from mitmproxy import http, websocket
from mitmproxy.test import taddons, tflow, tutils
from wsproto.frame_protocol import Opcode

SCHEMA = json.loads((Path(__file__).parent.parent / "schemas" / "brim-capture-flow.schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA)

ROUTES = [
    {
        "cli": "claude",
        "host": "api.anthropic.com",
        "methods": ["POST"],
        "path": r"^/v1/messages(\?|$)",
        "websocket": False,
    },
    {
        "cli": "codex",
        "host": "chatgpt.com",
        "methods": ["GET"],
        "path": r"^/backend-api/codex/responses(\?|$)",
        "websocket": True,
    },
]


@pytest.fixture
def addon(tmp_path: Path) -> Iterator[brim_capture.BrimCapture]:
    instance = brim_capture.BrimCapture()
    with taddons.context(instance) as tctx:
        tctx.configure(
            instance,
            brim_capture_spool=str(tmp_path / "spool"),
            brim_capture_routes=json.dumps(ROUTES),
        )
        yield instance
        instance.done()


def records(tmp_path: Path) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for segment in sorted((tmp_path / "spool").glob("*.jsonl")):
        lines.extend(json.loads(line) for line in segment.read_text().splitlines())
    for record in lines:
        errors = sorted(VALIDATOR.iter_errors(record), key=str)
        assert not errors, [error.message for error in errors]
    return lines


def claude_flow(path: str = "/v1/messages?beta=true", **response_kwargs: Any) -> http.HTTPFlow:
    request = tutils.treq(
        host="api.anthropic.com",
        port=443,
        method=b"POST",
        path=path.encode(),
        headers=http.Headers(
            [
                (b"Authorization", b"Bearer sk-ant-oat01-secret"),
                (b"x-api-key", b"sk-ant-api03-secret"),
                (b"Cookie", b"session=abc"),
                (b"X-Claude-Code-Session-Id", b"08d800da-5eeb-43c2-8b7c-93423a00bac5"),
                (b"anthropic-beta", b"oauth-2025-04-20"),
                (b"x-refresh-token", b"tok"),
                (b"Content-Type", b"application/json"),
            ]
        ),
        content=b'{"model":"claude-opus-5-5","messages":[{"role":"user","content":"hi"}]}',
    )
    response = tutils.tresp(**response_kwargs)
    return tflow.tflow(req=request, resp=response)


def drive_http(addon: brim_capture.BrimCapture, flow: http.HTTPFlow, chunks: list[bytes] | None = None) -> None:
    addon.requestheaders(flow)
    addon.responseheaders(flow)
    if chunks is not None:
        response = flow.response
        assert response is not None
        assert callable(response.stream)
        for chunk in [*chunks, b""]:
            assert response.stream(chunk) == chunk
        response.content = None
    addon.response(flow)


def test_records_an_allowed_request_without_credential_headers(addon: brim_capture.BrimCapture, tmp_path: Path) -> None:
    flow = claude_flow(headers=http.Headers([(b"Set-Cookie", b"a=b"), (b"Content-Type", b"application/json")]))
    drive_http(addon, flow)
    addon.done()
    [record] = records(tmp_path)
    assert record["kind"] == "http"
    assert record["cli"] == "claude"
    assert record["path"] == "/v1/messages?beta=true"
    names = [name.lower() for name, _ in record["request"]["headers"]]
    assert "x-claude-code-session-id" in names
    assert "anthropic-beta" in names
    for dropped in ("authorization", "x-api-key", "cookie", "x-refresh-token"):
        assert dropped not in names
    assert [name.lower() for name, _ in record["response"]["headers"]] == ["content-type"]
    assert json.loads(record["request"]["body"]["text"])["model"] == "claude-opus-5-5"
    assert "secret" not in json.dumps(record)


def test_ignores_non_inference_paths_on_an_intercepted_host(addon: brim_capture.BrimCapture, tmp_path: Path) -> None:
    drive_http(addon, claude_flow(path="/api/event_logging/v2/batch"))
    drive_http(addon, claude_flow(path="/v1/messages/count_tokens"))
    addon.done()
    assert records(tmp_path) == []


def test_tees_a_streamed_response_without_changing_it(addon: brim_capture.BrimCapture, tmp_path: Path) -> None:
    flow = claude_flow(headers=http.Headers([(b"Content-Type", b"text/event-stream")]), content=b"")
    chunks = [b"event: message_start\ndata: {}\n\n", b"event: message_stop\ndata: {}\n\n"]
    drive_http(addon, flow, chunks)
    addon.done()
    [record] = records(tmp_path)
    assert record["response"]["streamed"] is True
    assert record["response"]["body"]["text"] == b"".join(chunks).decode()


def test_decodes_a_compressed_response(addon: brim_capture.BrimCapture, tmp_path: Path) -> None:
    flow = claude_flow(
        headers=http.Headers([(b"Content-Encoding", b"gzip"), (b"Content-Type", b"application/json")]),
        content=b"",
    )
    drive_http(addon, flow, [gzip.compress(b'{"ok":true}')])
    addon.done()
    [record] = records(tmp_path)
    assert record["response"]["body"] == {"text": '{"ok":true}'}


def test_records_a_failed_flow(addon: brim_capture.BrimCapture, tmp_path: Path) -> None:
    flow = claude_flow()
    flow.response = None
    addon.requestheaders(flow)
    flow.error = tflow.terr("connection reset")
    addon.error(flow)
    addon.done()
    [record] = records(tmp_path)
    assert record["response"] is None
    assert record["error"] == "connection reset"


def test_records_websocket_messages_in_both_directions(addon: brim_capture.BrimCapture, tmp_path: Path) -> None:
    flow = tflow.tflow(
        req=tutils.treq(
            host="chatgpt.com",
            port=443,
            method=b"GET",
            path=b"/backend-api/codex/responses",
            headers=http.Headers(
                [
                    (b"Upgrade", b"websocket"),
                    (b"Authorization", b"Bearer token"),
                    (b"chatgpt-account-id", b"acct"),
                    (b"session-id", b"01a1c37b-1894-7231-a7ae-e3d2da985034"),
                ]
            ),
        ),
        resp=tutils.tresp(status_code=101),
        ws=True,
    )
    ws = flow.websocket
    response = flow.response
    assert ws is not None
    assert response is not None
    ws.messages = []
    addon.requestheaders(flow)
    addon.responseheaders(flow)
    assert response.stream is False
    addon.response(flow)
    addon.websocket_start(flow)
    for from_client, payload in [
        (True, {"type": "response.create", "input": [], "model": "gpt"}),
        (False, {"type": "response.completed", "response": {"id": "resp_1"}}),
    ]:
        ws.messages.append(
            websocket.WebSocketMessage(Opcode.TEXT, from_client, json.dumps(payload).encode(), 1794280980.5)
        )
        addon.websocket_message(flow)
    ws.messages.append(websocket.WebSocketMessage(Opcode.BINARY, False, b"\xff\x00", 1794280981.0))
    addon.websocket_message(flow)
    ws.close_code = 1000
    ws.close_reason = ""
    addon.websocket_end(flow)
    addon.done()
    opened, client, server, binary, closed = records(tmp_path)
    assert opened["kind"] == "ws-open"
    assert opened["cli"] == "codex"
    header_names = [name for name, _ in opened["requestHeaders"]]
    assert "session-id" in header_names
    assert "Authorization" not in header_names
    assert [client["seq"], server["seq"], binary["seq"]] == [0, 1, 2]
    assert client["fromClient"] is True
    assert server["fromClient"] is False
    assert client["at"] == "2026-11-10T03:23:00.500Z"
    assert binary["body"] == {"base64": "/wA="}
    assert closed == {
        "v": 1,
        "kind": "ws-close",
        "id": flow.id,
        "at": closed["at"],
        "code": 1000,
        "reason": None,
    }


def test_spool_is_private_and_closed_segments_are_renamed(addon: brim_capture.BrimCapture, tmp_path: Path) -> None:
    drive_http(addon, claude_flow())
    spool = tmp_path / "spool"
    [open_segment] = spool.glob("*.jsonl.part")
    assert stat.S_IMODE(spool.stat().st_mode) == 0o700
    assert stat.S_IMODE(open_segment.stat().st_mode) == 0o600
    addon.done()
    assert list(spool.glob("*.part")) == []
    [closed] = spool.glob("*.jsonl")
    assert stat.S_IMODE(closed.stat().st_mode) == 0o600


@pytest.mark.parametrize(
    ("name", "sensitive"),
    [
        ("Authorization", True),
        ("Proxy-Authorization", True),
        ("x-api-key", True),
        ("Set-Cookie", True),
        ("x-amz-security-token", True),
        ("X-Client-Secret", True),
        ("x-claude-code-session-id", False),
        ("anthropic-beta", False),
        ("thread-id", False),
    ],
)
def test_sensitive_header_names(name: str, sensitive: bool) -> None:
    assert brim_capture.is_sensitive_header(name) is sensitive
