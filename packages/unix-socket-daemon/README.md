# @shepherdjerred/unix-socket-daemon

Scaffolding shared by the repo's local unix-socket HTTP daemons, currently
`toolkit discord` (`packages/toolkit/src/lib/discord/serve.ts`) and the
mc-harness daemon behind `toolkit mc` (`packages/mc-harness/src/daemon/serve.ts`).

| Export                                     | Purpose                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serveUnixDaemon(opts)`                    | `Bun.serve` on the socket (mode 0600) with live-socket protection (`AlreadyRunningError`), a `/shutdown` route, idle-TTL exit, non-overlapping `onTick`, 0600 state |
| `withDaemonStartLock(opts, fn)`            | Cross-process startup serialization via atomic `<lockPath>` `mkdir` (`owner.pid` + timestamp) with dead-PID and timeout stale-lock recovery                         |
| `terminateDaemonChild(pid, opts)`          | Escalates `SIGTERM` → `SIGKILL` against a failed or timed-out spawned daemon process so wedged `unref()`ed children never leak                                      |
| `isDaemonPid(pid, opts)`                   | Proves a saved PID is still the daemon (its `/status` PID, live `socketPath`, else `ps` command line matching `marker`/`entryMatch`) before signalling or unlinking |
| `processCommand`, `pidAlive`, `pathExists` | Process and socket probes (`pathExists` uses `stat`; `Bun.file().exists()` is false for sockets)                                                                    |
| `parseTtl`, `jsonlLogger`                  | `90m`/`4h`/`30s` TTL parsing; one JSONL log line per event (never log secrets)                                                                                      |

Daemon-specific routing, state shape and teardown stay in each daemon.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/unix-socket-daemon
```
