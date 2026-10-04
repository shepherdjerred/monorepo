# @shepherdjerred/mc-harness

Runtime behind `toolkit mc`: disposable Minecraft sandboxes, the typed client
for the MCBridge Paper plugin, and the session daemon that holds them.

## Layout

| Path                    | What it is                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `src/protocol/`         | Zod-only contracts: the MCBridge wire API, daemon IPC, paths, protocol version             |
| `src/bridge/client.ts`  | `BridgeClient` — bearer-authenticated, every response validated against the contract       |
| `src/pins.ts`           | Pinned itzg image, Paper 26.2 build, WorldEdit and Citizens jars (url + sha256)            |
| `src/providers/docker/` | Docker CLI wrapper, reusable Paper-container helpers, and the Docker sandbox provider      |
| `src/sandbox/`          | Sandbox records (0600, hold secrets), profiles, and the provider contract                  |
| `src/target.ts`         | `Target`: one server the harness acts on (bridge client + log tail)                        |
| `src/daemon/`           | Unix-socket daemon: idle TTL, JSONL logs, sandbox lifecycle, and target passthrough routes |
| `src/protocol/build.ts` | Build workspace files, the op log and manifest schemas (shared with toolkit `--record`)    |
| `src/build/`            | `toolkit mc build` CLI: capture, canvas, compile, run, render, lint, replay, promote, undo |

`toolkit` is compiled to a single binary and may import only `src/protocol/*`;
an architecture boundary keeps that directory free of daemon, provider, and
bridge-client code. The-storm's E2E harness reuses `providers/docker/` for its
own Paper container.

## Bridge contract

`src/protocol/bridge.ts` mirrors MCBridge (`packages/the-storm/plugin/bridge`).
Routes live under `/v1` and require `Authorization: Bearer <MC_BRIDGE_TOKEN>`;
schemas are strict so plugin/harness skew fails as a `contract` error instead of
a misread field. Region reads return a palette plus base64 little-endian uint32
indices in YZX order.

## Sandboxes

The `paper` profile boots the pinned image with Paper 26.2, WorldEdit, and the
repo-built `MCBridge.jar` (build it with
`mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble`). Worlds are
`flat` or `void`. Game (25565), RCON (25575), and bridge (25580) ports are
published on `127.0.0.1` only. The per-sandbox bridge token and RCON password
are generated at create time and stored only in
`~/.toolkit/mc/sandboxes/<id>/record.json`; IPC responses carry a summary
without them.

Containers carry `mc-harness.*` labels (sandbox id, profile, expiry, owner,
keep). The daemon reaps expired and exited sandboxes on start, before each
create, and every 30 seconds while it runs, and removes non-kept sandboxes when
it shuts down. The socket server, idle TTL, state file and the PID identity
check behind `toolkit mc daemon stop` come from `@shepherdjerred/unix-socket-daemon`:
a stale state file whose PID now belongs to another process is cleaned up
without signalling it. Creates are
serialized because boots share the Paperclip warm cache under
`~/.toolkit/mc/cache`.

## Builds

A build directory is the unit of work: `build.json` (name, world, anchor,
seed, captured site box and `siteHash`, canvas id), `build.oplog.json` (ordered
WorldEdit, paste and console ops, each with explicit coordinates and a
`source` of `manual` or `program:<sha>`), `build.ts`, `site/` and `renders/`.

- **Capture** snapshots the site box (bridge `.schem`) and analyzes it
  (heightmap, water/vegetation masks, `siteHash`).
- **Canvas** is a void sandbox with the site pasted at its real coordinates;
  **run** resets it to the site, replays every op, and freezes the result as
  `expected.schem` + `expected.json`.
- **Replay** proves the log is deterministic on a fresh seeded sandbox. Random
  WorldEdit `%` patterns are not, so promote never depends on replaying ops.
- **Promote** checks the target still matches `siteHash`, requires the dry
  run's `planHash`, snapshots the box for undo, pastes `expected.schem`, and
  verifies it cell by cell. The journal (`~/.toolkit/mc/journal/<target>/`)
  records the snapshot id; **undo** restores it last-in-first-out.

The CLI reaches servers only through the daemon socket, so the daemon remains
the sole owner of sandboxes and bridge tokens.

## Commands

```bash
bun run typecheck
bun run test
bun run lint
bun run daemon     # run the daemon in the foreground (toolkit mc daemon start detaches it)
```
