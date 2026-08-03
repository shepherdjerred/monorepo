---
title: PR Fleet Controller
description: A foreground, provider-neutral controller that repairs and publishes the whole fleet of open pull requests with bounded per-stack workers — and the authority boundary that keeps it from ever merging, closing, or approving anything.
---

The **PR Fleet Controller** is a standalone tool that watches every open pull
request in the repository and drives each one toward "ready for a human" —
fixing failing checks, resolving review findings, and re-requesting review —
without ever merging, closing, or approving a PR itself. An operator runs it in
the foreground and steers it conversationally; the model does the work inside a
tightly bounded sandbox.

## Running it

```bash
bun run pr:fleet --model <provider>/<model-id>
```

One selected API model powers both the conversational master and every bounded
worker, so the controller is **provider-neutral** — point it at any supported
model. Once running, an operator uses `/status`, `/tick`, `/help`, `/stop`, or
plain free-text steering ("focus on the release PRs", "pause #1855").

## What it may and may not do

The authority boundary is the whole point. The controller may:

- read a PR's checks, review threads, and CI evidence;
- edit files, run validation, and publish commits to a PR's own branch;
- re-request review from the configured provider.

It may **never** merge, close, approve, weaken a gate, or touch any branch other
than the one it was dispatched for. That boundary is enforced in code, not just
prompt instructions — the worker's tools simply do not expose those actions.

## How the work is bounded

- **One worker per stack.** Each git-spice stack shares a single worktree, and
  only one worker holds it at a time; siblings queue. A worker is dispatched
  against a specific PR head, and its worktree is synced to that head first.
- **Leases** serialize the expensive/dangerous steps — setup (dependency
  install + codegen), heavy commands, and the stack-write that publishing needs.
  Leases are released only after a worker actually settles, so a cancelled or
  closed worker's in-flight Git/subprocess work can never overlap a freshly
  dispatched one.
- **Head changes cancel the worker.** If someone pushes to a PR while a worker
  is mid-flight, the controller cancels that worker (its checkout is now stale)
  and re-dispatches against the refreshed commit rather than letting it publish
  obsolete work.
- **Review completion is read the same way the canonical gate reads it** —
  including the provider's bot-author skip policy, so bot-authored PRs (Renovate,
  release automation) that a provider never reviews don't sit pending forever.

## The validation sandbox

Worker validation commands run under macOS `sandbox-exec` with a
**deny-by-default** policy. Reads are confined to the assigned worktree plus
specific toolchain directories; the process's own temp dir is readable but the
broader `/private` and home-cache trees are not — a model-controlled command
cannot read `~/.aws`, `~/.ssh`, or arbitrary application caches and echo them
back. Writes are confined to the worktree and temp dirs, network is denied, and
credential-bearing environment variables are stripped from the subprocess. Only
a fixed allowlist of read-only tools (`bun`, `cargo`, `go`, `helm`, `tofu`,
`rg`, …) may run, and command forms that would execute an arbitrary nested
program are rejected.

## Where to look next

- Package and exact model tool boundary: `packages/pr-fleet-controller/`
  (see its `README.md`).
- The provider-neutral review abstraction it shares with the Buildkite review
  gate: `@shepherdjerred/code-review`.
