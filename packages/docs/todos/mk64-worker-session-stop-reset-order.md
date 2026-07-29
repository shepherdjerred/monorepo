---
id: mk64-worker-session-stop-reset-order
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-07-28_mk64-runtime-performance-followup.md
source_marker: false
---

# Fix MK64 Worker reset ordering when a session stops

The live PR #1779 verification found a teardown race after an otherwise
successful `/play` and `/stop`. `MarioKartGameDriver.onSessionStop()` requests
stream shutdown, destroys the stream actor, persists saves, and stops the
Worker. The actor's asynchronous `afterLeaveVoice()` hook can then invoke
`onSessionEnded`, which calls `WorkerEmulator.restartFromStartMenu()` after the
Worker is gone:

```text
emulator reset after stream session failed emulator worker is not running
```

The user-visible session and Go-Live stream still stop, but teardown should not
emit an application error or send an invalid command to a terminated Worker.

## Remaining

- [ ] Define the intended distinction between a stream ending while a game
      session remains active and the whole game session being torn down.
- [ ] Make the stream/session lifecycle preserve that ordering without
      swallowing the Worker error.
- [ ] Add a regression test that fails if the session-end reset runs after
      `WorkerEmulator.stop()`.
- [ ] Re-run `/play` then `/stop` against the live candidate and confirm the
      Worker reset-order error is absent.

## Comment Log

- 2026-07-28 — Observed during the privileged PR #1779 live verification.
  Startup, streaming, and performance succeeded; this error occurred only
  after `/stop` while the asynchronous stream teardown completed.
