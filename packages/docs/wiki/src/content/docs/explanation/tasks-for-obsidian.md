---
title: About the TaskNotes clients
description: Why Facet native apps share a Rust task runtime and synchronize vaults without a TaskNotes server.
sidebar:
  order: 6
---

Facet edits TaskNotes Markdown through a shared Rust runtime, with native apps
supplying secure storage, filesystem capabilities and transport.

A vault can be a selected local folder or an app-private Obsidian Sync replica.
Both choices work without a TaskNotes server. SQLite records indexes, immutable
actions, synchronization checkpoints and conflicts; Markdown holds the task data.

Markdown survives applications and makes tasks available to Obsidian and ordinary
editors. A durable local coordinator protects interrupted edits during disconnection.

## Why policy lives in a shared core

Recurrence, mutations and filtering are easy to make almost identical.
Small differences become dangerous when several clients edit the same files.

The [Rust implementation](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-core)
separates pure task/vault logic from its SQLite runtime adapter. Generated UniFFI
bindings connect Swift, Kotlin and C# hosts to that runtime.

Queries, configured fields, arbitrary workflow values and receipts cross a
language-neutral schema. Each host validates it. Native presentation chooses
queries and formats results; it does not reconstruct task semantics.

The [iOS product](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasks-for-obsidian)
uses SwiftUI and the shared Apple host. Android uses Compose with generated Kotlin
bindings. Language-neutral scenarios provide the independent behavioral oracle.

## Why clients still have host code

The pure core performs no filesystem, network or clock I/O. The runtime adapter
owns SQLite coordination. Native hosts implement operating-system capabilities.

The [Apple host](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-macos)
supplies coordinated folder access, URLSession and Keychain. Android supplies
private replica files, platform transport and Keystore-backed secrets.
The [Windows host](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-windows)
supplies atomic local files, platform HTTP/WebSockets and secure credentials.

A folder picker grants access; it does not prove safe writes. Supported providers
must preserve confinement, materialize bytes and retain displaced versions until
the runtime acknowledges them. Unsupported capabilities fail visibly.

Private Sync replicas avoid asking external providers to implement those
operations. The Rust Sync session emits transport and checkpoint effects.
The host commits checkpoint changes before acknowledging their exact revision.
It applies downloaded bytes before completing the corresponding remote notice.

Vault keys and account tokens belong in platform secure storage. Widgets receive
small durable projections and actions. Shared containers cannot become credential
caches. Downloaded Obsidian configuration is data; native hosts do not execute plugins.

## What remains authoritative

An applied local mutation becomes a coordinated Markdown edit and a durable
receipt. A Sync profile also retains an immutable upload snapshot. Incoming
changes merge against durable base bytes; unsafe merges enter the conflict inbox.

Receipt identity includes the original timestamp, payload and owning profile.
Retaining a UUID while changing the timestamp produces a different action.
The complete envelope lets a restarted host retry an uncertain response safely.

Native integration checks inspect real Markdown after editing and relaunch.
Filesystem recovery, schema conformance, rendered interaction, live Sync and
signed store artifacts prove different boundaries. A rendered task alone cannot
prove that the vault was saved correctly.
