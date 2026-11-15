---
title: About the Facet Architecture
description: Why Facet uses a PostgreSQL backend, a modernized Todoist-style Sync API, and 1Password Typeshare for native Apple and Windows clients.
sidebar:
  order: 6
---

Facet is an offline-first, multi-platform task management system designed around a centralized PostgreSQL database, a high-performance Hono API server, and native SwiftUI (iOS & macOS) and WinUI 3 (Windows) clients.

Wire and domain contracts are maintained in a canonical Rust protocol crate using 1Password's Typeshare, which generates native TypeScript interfaces and Swift `Codable` structs with zero runtime FFI or binary linking overhead.

## Why a Centralized Database Replaced File-Based Storage

Earlier iterations stored tasks as Markdown files with YAML frontmatter. While human-readable in text editors, treating plaintext Markdown as an ACID task database introduced severe accidental complexity:

1. **Text Parsing Bottlenecks:** Every mutation required parsing Markdown ASTs, preserving non-task frontmatter, and handling whitespace diffs without corrupting files.
2. **Proprietary Sync Overhead:** Synchronizing vaults required reverse-engineering proprietary end-to-end encryption protocols or running headless desktop apps in container sidecars with shared persistent volumes.
3. **Relational Mismatch:** Tasks inherently have relational properties: subtask trees, project and section hierarchies, labels, priorities (P1–P4), and scheduled reminders. PostgreSQL provides transactional integrity, foreign keys, and instant indexing that text files cannot match.

## The Todoist-Pattern Sync Architecture

Traditional REST endpoints fall short for mobile and offline task management. If a user creates a project and tasks while disconnected, REST requires sequential calls and risks duplicate mutations on network dropouts.

Facet adopts the architecture of the **Todoist Sync API**:

- **Incremental Delta Synchronization:** Clients pass a `sync_token` representing their last known synchronization state. The server queries only records updated or soft-deleted since that sequence or timestamp, minimizing network payload and battery drain.
- **Atomic Command Batches:** Clients queue mutations locally as commands (`TaskAdd`, `TaskUpdate`, `TaskComplete`, `TaskDelete`, `ProjectAdd`, etc.). The server executes the entire batch inside a single PostgreSQL ACID transaction.
- **Temporary ID Remapping (`temp_id_mapping`):** Clients generate client-side temporary UUIDs (`tmp-...`) for newly created items. Subsequent commands in the same batch can reference these temporary IDs in foreign keys (e.g. adding a task into a project created in the same offline session). The server assigns permanent database UUIDs and returns a mapping table so clients reconcile local foreign keys seamlessly.
- **Idempotency Guarantees:** Every command includes a client-generated UUID. If an HTTP response drops in transit and the client retries, the server verifies `ProcessedCommand` records and avoids duplicate insertions.

## Type Parity via 1Password Typeshare

Facet defines its domain models, commands, requests, and responses once in `packages/facet-protocol` using Rust structs and enums annotated with `#[typeshare]`.

Unlike UniFFI or C-FFI bindings, **Typeshare compiles no binary artifacts**. It is a pure syntax code generator that parses Rust ASTs and outputs native language code:

- **TypeScript (`facet-server`):** Consumed directly by Hono route handlers, Zod validators, and Prisma mapping layers.
- **Swift (`facet-apple`):** Pure Swift `Codable` structs used by SwiftUI views and local SQLite storage with full Swift 6 strict concurrency compliance.
- **C# (`facet-windows`):** DTO records generated via JSON Schema for WinUI 3.

This design completely eliminates runtime FFI boundaries, binary ABI pinning, and cross-platform compilation bottlenecks in CI.
