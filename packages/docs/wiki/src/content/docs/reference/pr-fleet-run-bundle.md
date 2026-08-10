---
title: PR fleet run bundle
description: What every fleet run writes to disk, where, and with which permissions.
sidebar:
  order: 6
---

Every `pr:fleet` run creates a private local evidence bundle. Bundles are
local-only and retained until the operator deletes them.

## Location

|          | Path                                                    |
| -------- | ------------------------------------------------------- |
| Default  | `${XDG_STATE_HOME:-~/.local/state}/pr-fleet-controller` |
| Override | `--state-dir <path>`                                    |

## Permissions

| Object             | Required mode                    |
| ------------------ | -------------------------------- |
| State directory    | owned by the operator, `0700`    |
| Persisted files    | `0600`                           |
| Run control socket | `0600`, inside the run directory |

The controller fails **before** model access or any PR mutation if the selected
directory does not meet these requirements.

## Contents

| Artifact            | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `manifest.json`     | schema version, source provenance, model, and capture contract |
| `events.jsonl`      | sequenced, hash-chained evidence and lifecycle events          |
| `summary.json`      | terminal fleet state, counts, final hash, and telemetry digest |
| `spans.jsonl`       | authoritative, redacted model and tool telemetry in schema v2  |
| Unix control socket | carries same-origin dashboard answers to the live controller   |

Schema-v2 summaries bind the byte length and SHA-256 digest of `spans.jsonl`,
so inspection and replay detect telemetry tampering. New runs do not create
`mastra.db` or `observability.duckdb`.

Readers retain complete schema-v1 inspection, replay, and dashboard support for
historical bundles that contain those database files. Existing bundles are
never rewritten.

## Redaction

Payloads are redacted before persistence. The literal-value and
secret-shaped-field redactors run before both the hash-chained events and the
model and tool spans are written, so persisted bodies contain only redacted
values.

## Question binding

| Rule                                        | Behaviour                       |
| ------------------------------------------- | ------------------------------- |
| An answer is bound to its PR and exact head | mismatched answers are rejected |
| Head moves                                  | unanswered request superseded   |
| PR goes green                               | unanswered request superseded   |
| PR closes                                   | unanswered request superseded   |

## Related

- [PR fleet CLI](/reference/pr-fleet-cli/) — `inspect` and `replay` flags
- [How to inspect a fleet run](/how-to/inspect-a-fleet-run/)
