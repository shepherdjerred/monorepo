---
id: mk64-stop-bricks-stream-account
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: 2026-08-03 press-to-glass measurement session
---

# `/stop` bricks the MK64 stream account until the pod restarts

After a `/stop`, every subsequent `/play` reports success but never goes live.
Reproduced three times on 2026-08-03 while cycling sessions for latency
measurement; each time the only recovery was `kubectl rollout restart`.

## Symptoms

- `/play` replies "Starting Mario Kart 64 in Voice Channel …" as normal.
- `stream_active` stays `0`; the stream account never appears in the voice
  channel; no viewer ever sees a stream.
- Logs show the session starting but never reaching "Go-Live stream started".

## What the logs show

On the `/stop` path:

```
warn : selfbot client destroy failed (ignored) {"error":"null is not an object (evaluating 'this.connection.readyState')"}
info : session stopped {"reason":"userStop"}
info : Go-Live stream stopped
error: emulator reset after stream session failed emulator worker is not running
         at post (worker-emulator.ts:257)
         at restartFromStartMenu (worker-emulator.ts:141)
         at onSessionEnded (mario-kart-driver.ts:140)
         at notifyStreamSessionEnded (game-streamer.ts:68)
         at afterLeaveVoice (game-streamer.ts:253)
```

An earlier instance escalated to an `uncaughtException` from the same place —
`sendHeartbeat` → `destroy` in `discord.js-selfbot-v13`'s `WebSocketShard`
(`WebSocketShard.js:661` → `:830`) — when the heartbeat fired against an
already-null connection.

## Two distinct faults

1. **Unrecoverable client state.** The stream account's selfbot client is torn
   down in a way it cannot come back from, and nothing re-establishes it. The
   `discord` skill already notes that this library's `destroy()` can throw; the
   catch here swallows it and leaves the account unusable rather than
   reconnecting or failing loudly.
2. **`/play` reports success when it cannot stream.** The command answers
   "Starting Mario Kart 64" without verifying the account went live. That is a
   fail-fast violation: a dead gateway should surface to the user, not be
   papered over with a success message.

The emulator-worker reset failure on the same path is likely a third, smaller
issue (the worker is already stopped when `onSessionEnded` tries to reset it).

## Remaining

- [ ] Reproduce locally and confirm whether the selfbot client can be
      re-logged-in in place, or whether the streamer needs to construct a fresh
      client per session.
- [ ] Make `/play` verify it actually went live and report the real failure
      when it did not.
- [ ] Fix or guard the `restartFromStartMenu` call so it does not fire against
      a stopped worker.
- [ ] Add a regression test covering stop → play on one process.

## Comment Log

- 2026-08-03: Filed from the press-to-glass measurement session. Worked around
  by never using `/stop` — restart the pod instead — which is why
  `scratchpad/start_stream.sh` deliberately avoids it. Not investigated
  further; measurement was the session's goal.
