---
title: PR fleet run bundle
description: What every fleet run writes to disk, where, and with which permissions.
sidebar:
  order: 6
---

Every `pr:fleet` run creates a private local evidence bundle. Bundles are
local-only and retained indefinitely in v1.

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

| Artifact                    | Purpose                                                       |
| --------------------------- | ------------------------------------------------------------- |
| Hash-chained event timeline | the auditable record of evidence seen and decisions made      |
| Final summary               | terminal fleet state and outcome                              |
| Mastra storage              | agent framework state                                         |
| `observability.duckdb`      | model and tool spans; the durable, verified source            |
| `spans.jsonl`               | best-effort live mirror of reasoning, tailed by the dashboard |
| Unix control socket         | carries same-origin dashboard answers to the controller       |

`observability.duckdb` is exclusively locked while the run holds it, which is
why reasoning is mirrored to `spans.jsonl` for the live dashboard.

## Redaction

Payloads are redacted before persistence. The literal-value redactor runs before
Mastra's structural sensitive-field filter, so both the hash-chained events and
the model and tool spans retain only redacted bodies.

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
