---
title: Durable agent chat storage reference
description: Catalog retention, provider checkpoint limits, and content-addressed session storage contracts.
---

Chat Workflows own immutable conversation identity; the catalog retains recent discovery metadata.

## Catalog and execution limits

| Contract                                 | Limit                                              |
| ---------------------------------------- | -------------------------------------------------- |
| Recent chat entries                      | 500                                                |
| Ingress bindings                         | 500                                                |
| Recent retired IDs                       | 500                                                |
| Serialized catalog state                 | 1,000,000 UTF-8 bytes                              |
| Pending turns per chat, including active | 8                                                  |
| Provider Activity admission + execution  | 1 hour queued + 2 hours executing; one attempt     |
| Chat command wait                        | 25 hours executing; 26 hours including queue delay |
| Receipt Workflow execution               | 131 hours; admission closes 3 hours before expiry  |
| Scheduled dispatch Activity              | 132 hours; provider admission closes after 129     |
| Scheduled Workflow execution             | 133 hours including shutdown margin                |

Sources: [shared contracts](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/shared/agent/agent-chat.ts), [catalog retention](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/agent-chat-catalog.ts), [turn execution](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/agent-chat.ts), [receipt admission](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/agent-chat-turn-receipt.ts), and [schedule dispatch](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/scheduled-agent-chat-turn.ts).

Catalog eviction removes discovery metadata and associated bindings, not the chat Workflow or its session objects. An explicit chat ID recovers the original configuration. A reused ID with different immutable configuration is rejected against the chat Workflow.

Source: [chat identity and lookup](https://github.com/shepherdjerred/monorepo/blob/6233897e0956e4a22ccdee583dfa8b0b0a54ae0d/packages/temporal/src/lib/agent-chat-client.ts).

## Turn receipts

| Contract                            | Value                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| Receipt identity                    | `agent-chat/<chat-id>/turn/<sha256(turn-id)>`                         |
| Retention                           | Completed Workflow history; 30 days in production and beta            |
| Idempotency window                  | While the receipt history remains available                           |
| Chat dispatch                       | Exact run ID and stable Update ID                                     |
| Ambiguous admission or result       | Retry only the original pinned run                                    |
| Run replacement                     | Only after proving the original run closed without admission          |
| Reused turn ID with different input | Rejected before returning a retained outcome                          |
| Expired receipt history             | A reused turn ID can create a new receipt and repeat provider effects |
| Receipt Activity queue              | `agent-chat-receipts`; repo role; concurrency 1                       |

Sources: [receipt Workflow](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/agent-chat-turn-receipt.ts), [run-pinned dispatch](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/lib/agent-chat-receipts.ts), [client input validation](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/lib/agent-chat-client.ts), and [namespace retention](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/temporal/namespace-init.ts).

## Provider checkpoints

| Contract                        | Limit or value                                    |
| ------------------------------- | ------------------------------------------------- |
| Manifest schema version         | 2; other versions rejected                        |
| Chunk size                      | 1 MiB; final chunk may be smaller                 |
| Individual session file         | 128 MiB                                           |
| Complete provider session slice | 256 MiB                                           |
| Files per manifest              | 1,000                                             |
| Object upload/download          | 2 MiB                                             |
| Bucket                          | `agent-chat-sessions`; non-expiring, daily backup |

Sources: [checkpoint chunks](https://github.com/shepherdjerred/monorepo/blob/6233897e0956e4a22ccdee583dfa8b0b0a54ae0d/packages/temporal/src/activities/agent/chat/session-checkpoint.ts), [manifest contracts](https://github.com/shepherdjerred/monorepo/blob/6233897e0956e4a22ccdee583dfa8b0b0a54ae0d/packages/temporal/src/activities/agent/chat/session-bundle.ts), [bounded object transfers](https://github.com/shepherdjerred/monorepo/blob/6233897e0956e4a22ccdee583dfa8b0b0a54ae0d/packages/temporal/src/activities/agent/chat/session-store.ts), and [bucket policy](https://github.com/shepherdjerred/monorepo/blob/6233897e0956e4a22ccdee583dfa8b0b0a54ae0d/packages/seaweedfs-backup/policy.json).

Turn manifests identify the chat, provider session, turn, workspace path, files, and ordered chunk hashes. Chunks use per-chat content-addressed keys. Existing chunks are reused; manifests remain immutable per turn attempt. Downloads validate chunk and complete-file hashes before session resume.

The entire file is scanned for mounted and provider credential bytes before upload, including matches crossing chunk boundaries. Decoded Codex access, refresh, and ID tokens are included. Authentication, configuration, and workspace files are excluded. Symbolic links and paths outside the session home are rejected.

Source: [checkpoint credential selection](https://github.com/shepherdjerred/monorepo/blob/b6d771ba44aabb3673872a35653668ad3bceabb0/packages/temporal/src/activities/agent/chat/run-agent-chat-turn.ts).

## Related

- [Durable agent chat architecture](/explanation/temporal/durable-agent-chats/)
