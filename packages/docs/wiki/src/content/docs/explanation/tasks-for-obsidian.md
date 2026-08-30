---
title: About the TaskNotes clients
description: Why native and React Native clients share one Rust policy core over an authoritative markdown vault.
sidebar:
  order: 6
---

TaskNotes keeps durable task data in a markdown vault while several clients
provide platform-native interaction. The vault remains authoritative; clients
cache and queue work but never become a second source of truth.

The central tension is unchanged. Markdown is ideal for data meant to outlive
an application, but poorly suited to an occasionally offline device that must
feel immediate.

## Why policy lives in a shared core

Recurrence, mutations, filtering, and synchronization are easy to make almost
identical. Almost identical is dangerous when every client edits the same
files.

The native macOS and Windows clients therefore call one Rust core through
generated UniFFI bindings. Their shells provide storage, HTTP, time, randomness,
and retry timers. They do not reinterpret domain or wire rules.

That boundary covers writing recurrence rules as well as reading them. The
shared core parses only the common patterns a native editor can reproduce
without loss, validates recurrence drafts, and serializes their canonical
RRULE form. A shell may collect an interval, weekdays, calendar pattern, ending,
and anchor, but it does not assemble rule text. Existing rules outside that
closed editor model remain authoritative until a person explicitly replaces
them.

Windows adds a portable Presentation layer between WinUI and the host. Focused
view models own navigation, validation, command state, and screen projections.
This keeps Windows UI code testable without loading WinUI or the generated
binding.

The React Native client still has a TypeScript implementation. Both languages
execute the same language-neutral JSON scenarios and recurrence corpus. Those
fixtures are the independent oracle that exposes drift.

## Why clients still have host code

The Rust core deliberately performs no filesystem, network, or clock I/O. Each
platform owns the capabilities only it can implement correctly.

- macOS uses app-container files, URLSession, and Keychain-backed settings.
- Windows uses atomic local-data files, HttpClient, and Credential Locker.
- React Native integrates with its existing mobile storage and navigation.

This split preserves platform-native security and lifecycle behavior without
copying synchronization policy.

## What remains authoritative

Every successful mutation eventually becomes a markdown edit on the server.
Offline commands are durable and replayable. Mutations the server cannot safely
apply are parked for an explicit retry or discard decision.

The iOS simulator and Windows packaged-app suites share orchestration for
temporary seeded vaults, real server processes, bearer authentication, and a
deterministic network-failure proxy. Platform drivers remain native: Maestro
drives iOS, while Windows uses UI Automation directly.

Parity is an evidence contract, not a list of test names. Each applicable
surface names the UI, server, persistence, or markdown assertions that must run
before the Windows gate accepts it.

The strongest integration checks inspect resulting markdown, not merely a
client's rendered state. A UI can look correct while the vault is wrong; the
file is the contract that matters.

## Related

- [React Native client](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasks-for-obsidian)
- [Rust core and generated bindings](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-core)
- [Native macOS client](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-macos)
- [Native Windows client](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-windows)
- [TaskNotes server](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-server)
