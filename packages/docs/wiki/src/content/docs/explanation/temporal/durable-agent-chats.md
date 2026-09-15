---
title: Durable agent chats on Temporal
description: Why agent conversations, provider sessions, schedules, and ingress bindings are separate durable concerns.
sidebar:
  order: 3
---

A durable agent chat is one Temporal identity that any transport can continue.

The chat owns turn ordering and provider identity. SeaweedFS owns the provider's
opaque resume files. An ingress owns only its current binding to a chat.

```mermaid
flowchart TB
  accTitle: Durable agent chat boundaries
  accDescr: iMessage, Discord, and schedules submit turns through one catalog. A long-lived Temporal workflow serializes each chat. The agent worker hydrates a provider session from SeaweedFS into a fresh workspace, runs Claude or Codex, and persists the next session slice.

  I[iMessage] --> C[Chat catalog]
  D[Discord] --> C
  S[Temporal Schedule] --> C
  C --> R[Retained turn receipt]
  R --> W[Long-lived chat Workflow]
  W --> A[Agent Activity]
  A --> P[Claude Code or Codex]
  A <--> O[SeaweedFS session bundle]
```

## Conversation identity is not transport identity

An iMessage conversation or Discord channel can select any cataloged chat.
Changing that selection updates one binding; it does not copy or rewrite chat
history. Scheduled chats use the same catalog and can later be selected from an
interactive ingress.

This separation avoids three parallel conversation systems. Transport adapters
normalize message IDs and prompts, then use the shared
[`agent-chat-client.ts`](https://github.com/shepherdjerred/monorepo/blob/6233897e0956e4a22ccdee583dfa8b0b0a54ae0d/packages/temporal/src/lib/agent-chat-client.ts)
path.

The dedicated Discord adapter exposes `/agent new`, `/agent continue`, and
`/agent list`. iMessage automation uses the bearer-authenticated gateway routes.
Both can explicitly select any cataloged chat; a successful turn makes that
chat active for the requesting Discord channel, thread, or iMessage
conversation. [The ingress reference](/reference/durable-agent-chat-ingress/)
defines those contracts.

## Temporal owns ordering

Each chat has a stable Workflow ID. Workflow updates serialize turns and return
the completed response to the caller. A bounded recent-turn ledger deduplicates
ordinary transport retries inside the current execution.

Each submitted turn also owns a completed
[receipt Workflow](https://github.com/shepherdjerred/monorepo/blob/b3f2db6bbbba3838b516c5a40648d4ee5d82e7ee/packages/temporal/src/workflows/agent-chat-turn-receipt.ts).
It keeps the original request and settled outcome after the chat compacts its
ledger or continues as new, while the receipt history remains within Temporal's
30-day production retention. Receipt dispatch pins one chat execution before
submission. An ambiguous result retries that same execution, never a newer one.
Only proven non-admission permits selecting a replacement execution. This
prevents a delayed transport retry from repeating provider tool effects during
the retention window. Reusing a turn ID after its receipt expires can repeat
those effects.

The selected provider and model are immutable chat configuration. Continuing a
chat never silently changes Claude to Codex or chooses a newer model. A
different provider is a different chat.

The catalog is also a Workflow. It records chat metadata, turn counts, and the
active binding for each ingress conversation. These are small coordination
records, so they belong in Temporal rather than the provider bundle. The
catalog retains bounded recent chats, bindings, and retired IDs. It retires
the least recently updated bindings first and then chats, so
the singleton Workflow cannot grow past Temporal's payload boundary.
Permanent ownership lives in each chat's Workflow, which starts during
registration and keeps its immutable configuration. Catalog eviction does not delete that Workflow or provider
session: an explicit chat ID can recover the original configuration and continue
the conversation after it drops out of the recent-chat list.

## Provider state is durable, workspaces are disposable

Claude Code and Codex retain opaque local files for session resume. The agent
Activity stores only the provider's session slice in the non-expiring,
daily-backed-up `agent-chat-sessions` SeaweedFS bucket. Credentials,
configuration files, and workspace files are excluded.
Immutable turn manifests reference content-addressed chunks. Unchanged
transcript chunks are reused across turns; transfers and integrity checks stream
one chunk at a time. This bounds transfer memory and avoids storing another
complete transcript for every turn. Exceeding a storage limit fails the
checkpoint rather than truncating provider state. The
[storage reference](/reference/durable-agent-chat-storage/) defines these limits.

Every turn starts with an empty workspace at the same deterministic path. The
stable path preserves providers whose resume identity includes the working
directory. Empty contents prevent accidental filesystem state from becoming a
second conversation memory.

Bundle objects are immutable per turn. A manifest records byte counts and
SHA-256 digests. After every file and the manifest are stored, the Activity
returns the exact manifest object key and the Workflow checkpoints it with the
provider session ID. Hydration uses only that checkpoint and rejects provider,
chat, turn, session, workspace, path, key, or digest mismatches.

## Schedules are normal chat turns

Temporal Schedules start a short dispatcher Workflow. Its Activity submits an
update to the long-lived chat through the same client path as an ingress. This
keeps schedule overlap policy separate from chat serialization and avoids a
second agent execution contract.

Recurring chat schedules are declared in source and reconciled with the rest of
the Temporal schedule catalog. This gives removal and drift the same lifecycle
as every other recurring homelab job. The first occurrence catalogs the chat;
it remains available for interactive continuation between later occurrences.

## Failure posture

Agent turns allow two Activity attempts but at most one provider invocation.
Before launch, the Activity writes a durable per-turn admission marker. A
second attempt can retry preparation while that marker is absent, return an
already-published turn result, or fail closed when admission was recorded but
publication was not. It never replays the provider after ambiguous execution.

The chat records a failed turn ID and returns the failure. A retry with the same
ID observes that settled failure. A caller can submit a new turn after deciding
whether repetition is safe.

This is a pragmatic homelab boundary. Provider subprocesses receive an allowlisted
environment without SeaweedFS or delivery credentials. Claude uses its subscription
credential with sandboxed tool access denied. Codex receives subscription tokens
through a private App Server pipe and retains them only in memory.
There is no Codex authentication file for tools to read during a turn.
Expired Codex authentication is terminal until the configured credential source
is renewed; the adapter does not silently switch providers or credentials.
Sources: [Claude adapter](https://github.com/shepherdjerred/monorepo/blob/fe7436e5f67a2c1018a006c88049192279d466e3/packages/temporal/src/lib/agent-runner/claude.ts)
and [Codex authentication protocol](https://github.com/shepherdjerred/monorepo/blob/fe7436e5f67a2c1018a006c88049192279d466e3/packages/temporal/src/lib/agent-runner/codex-app-server/protocol.ts).
The [agent task boundary](/explanation/temporal/agent-task-boundary/)
describes the surrounding worker isolation and its limits.

## Related

- [Temporal workflow inventory](/reference/temporal-workflows/)
- [Durable agent chat ingress](/reference/durable-agent-chat-ingress/)
- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Why Temporal](/explanation/temporal/overview/)
