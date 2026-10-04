# @shepherdjerred/unix-socket-daemon

Scaffolding shared by the repo's local unix-socket HTTP daemons, currently
`toolkit discord` (`packages/toolkit/src/lib/discord/serve.ts`) and the
mc-harness daemon behind `toolkit mc` (`packages/mc-harness/src/daemon/serve.ts`).

| Export                                     | Purpose                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `serveUnixDaemon(opts)`                    | `Bun.serve` on the socket (mode 0600) with a `/shutdown` route, idle-TTL exit, non-overlapping `onTick`, 0600 state file, SIGINT/SIGTERM cleanup |
| `isDaemonPid(pid, opts)`                   | Proves a saved PID is still the daemon (its `/status` PID, else `ps` command line contains the entry marker) before anyone signals it            |
| `processCommand`, `pidAlive`, `pathExists` | Process and socket probes (`pathExists` uses `stat`; `Bun.file().exists()` is false for sockets)                                                 |
| `parseTtl`, `jsonlLogger`                  | `90m`/`4h`/`30s` TTL parsing; one JSONL log line per event (never log secrets)                                                                   |

Daemon-specific routing, state shape and teardown stay in each daemon.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/unix-socket-daemon
```
