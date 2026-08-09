---
title: The PR fleet's authority boundary
description: Why a tool that edits and publishes to your branches is still safe to leave running unattended.
sidebar:
  order: 4
---

The PR fleet controller reads a pull request's checks and review threads, edits
files, runs validation, publishes commits, and re-requests review. It does all
of that under a model's direction, in the foreground, across every open PR at
once.

The reason that is tolerable is a boundary enforced in code rather than in
prompt text.

## What it may never do

The controller may **never** merge, close, approve, weaken a gate, or touch any
branch other than the one it was dispatched for.

This is not an instruction the model is asked to follow. The worker's tools
simply do not expose those actions. A model that decided to merge something
would find no way to express it.

The distinction matters because prompt-level constraints degrade: they can be
argued with, forgotten across a long context, or overridden by injected content
in a PR description. A missing tool cannot.

## Why bounded workers rather than one agent

Each git-spice stack gets one worker holding one worktree; siblings queue. A
worker is dispatched against a specific PR head and synced to that head first.

Two things follow from that. Work on unrelated PRs cannot interleave in one
checkout, and a worker always knows exactly which commit it is reasoning about.

If someone pushes mid-flight, the controller cancels that worker rather than
letting it publish work computed against a stale tree, then re-dispatches
against the refreshed commit.

Leases serialize the expensive and dangerous steps — dependency install and
codegen, heavy commands, and the stack-write that publishing needs. Leases are
released only after a worker fully settles, so in-flight Git work can never
overlap a freshly dispatched worker.

## Adopting your checkouts

The controller provisions its own disposable worktree per stack. But Git forbids
the same branch in two worktrees, so a PR you already have checked out would
otherwise be parked for the entire run.

Instead it reuses your checkout in place — and only when that checkout holds the
**exact** PR being worked. A matching branch is never reset.

Before touching anything it inventories staged and unstaged patches,
metadata-only untracked paths, local commits, and remote divergence. Untracked
file _contents_ are never serialized. Bounded subprocess capture marks oversized
evidence incomplete and blocks mutation entirely rather than acting on a partial
picture.

It can continue clearly related work and publish explicit paths or a captured
local commit head. Ambiguity — mixed staged work, uncertain history rewrites,
two equally valid fixes — becomes a question for you instead of a guess.

Worker file edits cannot touch Git metadata, even through a symlink.

## The validation sandbox

Model-directed commands run under macOS `sandbox-exec`, deny-by-default.

The threat being addressed is not a malicious model; it is a prompt-injected
one. A PR description is untrusted input, and a validation command is a natural
place for injected instructions to land.

So reads are confined to the assigned worktree and specific toolchain
directories. `~/.aws`, `~/.ssh`, the broader `/private` tree, and home caches
are unreadable, which means a command cannot exfiltrate credentials it was
persuaded to look for. Network is denied, credential-bearing environment
variables are stripped, and only a fixed allowlist of read-only tools may run.
Command forms that would execute an arbitrary nested program are rejected.

## Why the evidence bundle exists

Every run writes a hash-chained event timeline, a final summary, and model and
tool spans, all redacted before persistence.

An unattended tool that edits your branches needs to be answerable after the
fact: which evidence it saw, which decision it made, what actually ran. Replay
verifies that record offline without contacting a model or network, so trusting
the log does not require trusting the thing that wrote it.

## Related

- [Run the PR fleet](/how-to/run-the-pr-fleet/)
- [PR fleet CLI](/reference/pr-fleet-cli/)
- [Run bundle](/reference/pr-fleet-run-bundle/)
