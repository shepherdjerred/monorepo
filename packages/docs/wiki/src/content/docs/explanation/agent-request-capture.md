---
title: Agent request capture
description: Why Brim records coding agents' raw API requests through an observe-only local proxy, and how it keeps that record small, private, and tied to sessions.
---

Brim captures the exact request each coding agent sends to its model, because
the transcript a CLI writes is not what the model saw.

A transcript leaves out the system prompt, the tool schemas, injected
reminders, and how much of the context was served from cache. Those decide
cost and behavior. The capture records them, and the history daemon serves
them next to each session. [Capture raw agent requests](/how-to/capture-raw-agent-requests/)
is the procedure.

## Why a proxy

Every CLI talks to a different API in a different shape, and none exposes
its requests. A local TLS-intercepting proxy sees all of them at the one
place they are complete: on the wire. The alternative, patching or wrapping
each CLI's HTTP client, breaks on every release and cannot reach Rust and Go
binaries at all.

The proxy is a pinned [mitmproxy](https://mitmproxy.org/) with a thin addon,
[`brim_capture.py`](packages/toolkit/capture/brim_capture.py). It observes and
never changes a request. Streamed responses are copied as they pass, so the
agent sees no added latency. Only inference routes are recorded; telemetry and
plugin listings on the same hosts pass through unrecorded.

## Why a name-constrained CA, and no keychain

Interception needs the agent to trust a certificate authority Brim controls.
A CA in the login keychain would let anything that steals its key forge any
site for every app. This CA instead carries an X.509 `nameConstraints`
extension listing only the inference hosts, so a stolen key forges nothing
else. It is never installed anywhere: each CLI is pointed at it through its
own environment variable, and only when its wrapper runs.

OAuth and token endpoints are never intercepted. Hosts outside the list are
tunneled without decryption.

## Why it fails closed

When capture is on and the proxy is down, the agent wrapper refuses to start
the agent. The alternative is a silent gap: a session that looks captured and
is not. The error names the fix, and turning capture off is one setting.

## Why blocks, not bodies

Claude Code resends its whole context on every request, so a long session
would store the same megabytes hundreds of times. The daemon splits each
request into blocks (each system part, tool definition, and message) and
stores each block once, by content hash, compressed with zstd. A request
becomes an ordered list of references.

The same list gives the diff a person wants: which blocks a request added over
the previous one in its session. Each block renders as an
[OpenTelemetry GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
message, so a request's new blocks can later become a span unchanged.

## Why chaining

Codex, and Claude Code after its first request in a process, send only what
is new and name the server-side response they continue. Recording that alone
would show a request with no system prompt and one message. The daemon
rebuilds the full context by following the chain through earlier captures. A
chain whose start was never captured is marked incomplete rather than guessed.

## Why a separate store

The history index is rebuilt from transcripts whenever its schema changes.
Captures cannot be rebuilt: the spool is deleted once ingested. So they live
in their own `captures.sqlite`, are linked to a session by the CLI's session
id at read time, and are deleted only by retention.

## Limits

- Only Claude Code and Codex are verified. The other CLIs' routes are
  educated guesses until a logged-in run confirms them.
- Bodies are redacted with the `brim sync` credential patterns before they
  are stored, but prompts and tool output are kept as sent. Captures never
  leave the machine.
- A Cursor request is protobuf without a schema, so it is shown as raw fields.
