---
id: plan-provider-neutral-mastra-pr-fleet-controller-2026-07-29
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Provider-Neutral Mastra PR Fleet Controller

## Summary

Build a standalone Bun and Mastra controller for the complete open PR fleet in
`shepherdjerred/monorepo`. One API-hosted model, selected at launch, powers a
conversational master and bounded per-PR workers through the same typed tool
surface. Keep authoritative fleet state, leases, timers, worktree lifecycle,
Git publication, and readiness checks in deterministic controller code.

The controller may edit, validate, commit, push, and request current-head
review. It must never merge, close, or approve a PR, weaken a quality gate, or
grant models unrestricted repository or external-system access.

## Implementation

### Provider-neutral runtime and terminal

- Add a private `@shepherdjerred/pr-fleet-controller` Bun workspace and root
  `pr:fleet` command requiring `--model <provider>/<model>`.
- Use Mastra agents, tools, structured output, and finite tick workflows. Use
  one selected model for the master and every worker, with no silent provider
  fallback.
- Add a foreground interactive terminal supporting `/status`, `/tick`,
  `/help`, `/stop`, and queued free-text steering for the master.
- Keep all controller and conversation state in memory. Reconstruct live state
  on each launch instead of adding a database or Temporal dependency.

### Typed authority boundary

- Give the master only fleet status, tick, priority, pause/resume, worker
  guidance, worker-limit, explanation, and shutdown tools.
- Give workers bounded PR evidence, worktree file/search/patch, Git
  status/diff, Buildkite, review, merge-tree, stack, lease, validation,
  restack, and publication tools.
- Run local commands as validated argv in the assigned worktree, with no raw
  shell string and no direct deployment, Git publication, or external mutation
  commands.
- Keep setup, worktree provisioning, leases, Git metadata, explicit staging,
  hooks, commits, git-spice publication, review requests, agent lifecycle, and
  timers in deterministic controller code.

### Fleet workflow

- Implement the complete reconstructable PR state map, status schemas, worker
  result schema, event types, setup/heavy/stack-write leases, and one logical
  owner per PR.
- Run each tick as a finite workflow:
  reconcile workers, refresh all PRs, refresh current-head evidence, classify,
  dispatch, audit progress, and emit a compact heartbeat.
- Use one five- or ten-minute Bun timer, worker-completion wakeups, a tick
  mutex, and one pending-tick bit.
- Preserve repository-specific Buildkite, review-thread, merge-tree,
  git-spice, soft-failure, and Helm-type regeneration policies.

### Verification and delivery

- Unit-test schemas, state transitions, tool permissions, path containment,
  command policy, steering, timers, leases, structured output, and failure
  handling.
- Integration-test full fleet ticks and worker cycles with deterministic fake
  GitHub, Buildkite, Git, review, timer, process, and model ports.
- Run focused package build, typecheck, test, and lint verification, then rely
  on Buildkite for exhaustive repository gates.
- Publish through git-spice and attach an asciinema recording showing the
  interactive terminal and queued steering.

## Remaining

- [x] Scaffold and implement the package and root command.
- [x] Add unit and integration tests.
- [x] Run focused verification and repair every failure.
- [ ] Record the terminal demonstration and publish the draft PR.
- [ ] Verify current-head Buildkite, merge-tree, and review readiness.

## Comment Log

- 2026-07-29: Approved for implementation. V1 uses model APIs only, one model
  per invocation, queued steering, ephemeral controller state, and no coupling
  to native coding-agent CLIs or Temporal.

## Session Log — 2026-07-29

### Done

- Implemented `packages/pr-fleet-controller` and the root `pr:fleet` command.
- Added Mastra master and finite tick workflow, bounded workers, queued
  steering, typed state and evidence, worktree/setup/heavy/write leases,
  Buildkite logs, paginated reviews, independent merge-tree checks, git-spice
  restacking/publication, deduplicated review requests, abortable shutdown, and
  a no-network validation sandbox.
- Added 13 deterministic tests covering readiness, stacks, bounded
  concurrency, leases, command policy, parsers, structured output, and a full
  fake-port fleet tick.
- Passed package typecheck, test, lint, build, a live OpenAI Mastra routing
  smoke, a live read-only PR evidence probe, and a real `sandbox-exec`
  validation probe.

### Remaining

- Record and upload the terminal artifact, publish the draft PR, and validate
  its current-head Buildkite and hosted review results.

### Caveats

- OpenAI model routing was exercised live. Anthropic, xAI, OpenRouter/Kimi, and
  arbitrary OpenAI-compatible endpoints are implemented through the same
  Mastra model contract but were not each charged for redundant live smoke
  calls.
