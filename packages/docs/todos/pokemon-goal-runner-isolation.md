---
id: pokemon-goal-runner-isolation
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-28_pokemon-agent-reliability.md
source_marker: false
---

# Isolate the Pokémon goal agent runner

Goal Mode launches Codex in the backend container with unsandboxed command
execution. Restricting `/goal` to the user who started the session reduces who
can invoke it, but the model process still shares the backend container,
filesystem mounts, network namespace, and Unix user. The prompt and command
policy are behavioral guidance, not a security boundary.

## Remaining

- [ ] Run each goal in a dedicated short-lived container or Kubernetes Job with
      a per-goal scratch directory and no backend configuration, credentials,
      process environment, or other sessions' saves mounted.
- [ ] Replace direct backend access with a narrow authenticated control proxy
      scoped to one goal and one emulator session.
- [ ] Restrict runner egress to the model API and explicitly approved game
      knowledge sources.
- [ ] Apply CPU, memory, process, filesystem, runtime, and network limits, and
      guarantee cleanup after success, failure, timeout, and backend restart.
- [ ] Add adversarial integration tests proving a goal cannot read application
      secrets, inspect another session, call arbitrary cluster services, or
      retain access after termination.
- [ ] Document the threat model and operational recovery procedure before
      treating Goal Mode as safe for untrusted public invocation.

## Comment Log

- 2026-07-28 — Recorded during the reliability implementation. The immediate
  change limits `/goal` to the active session starter; full runner isolation is
  a separate architecture change and remains required before public access.

## Session Log — 2026-08-02

### Done

- Updated the origin path after the Pokémon reliability implementation plan moved to the completed archive.

### Remaining

- No change to this todo's existing isolation work.

### Caveats

- This was reference maintenance only.
