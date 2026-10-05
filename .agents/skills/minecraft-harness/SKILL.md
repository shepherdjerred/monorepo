---
name: minecraft-harness
description: Drive disposable Minecraft (Paper 26.2) sandboxes through `toolkit mc` — run console commands, edit with WorldEdit, read exact block states, snapshot and restore regions, playtest with Citizens actors, and watch events and logs — and make guarded, journaled, undoable changes on live tsmc with `--target live`. Use to try out a plugin change, prototype a build, validate a gameplay idea, or apply an agreed change to The Storm.
allowed-tools:
  - Bash
  - Read
---

# Minecraft harness

`toolkit mc` talks to the mc-harness daemon, which runs Paper 26.2 sandboxes
with WorldEdit and the repo's MCBridge plugin. Every world operation goes
through MCBridge, so reads return exact 26.2 block states and WorldEdit runs as
a named actor (`agent:<session>`) with its own undo history. Package detail:
`packages/mc-harness/README.md`.

## Safety

- Sandboxes by default. Live tsmc is reached only with an explicit
  `--target live`; read `references/live.md` first.
- A sandbox is disposable: it is removed at its TTL (default 2h) or when the
  daemon stops, unless created with `--keep`.
- Ports are bound to `127.0.0.1`. Never print the bridge token or RCON password
  from `~/.toolkit/mc/sandboxes/*/record.json`.

## Start

```bash
mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble   # build MCBridge.jar
toolkit mc sandbox up --world void      # or --world flat; auto-starts the daemon
toolkit mc info                          # versions, worlds, plugins, capabilities
```

`sandbox up` prints the sandbox id and the game port, so a person can join with
a 26.2 client at `127.0.0.1:<port>` (offline mode). With one sandbox running,
commands target it automatically; otherwise pass `--target <id>`.

`--provider kubernetes` runs the sandbox as a pod in the cluster's `mc-sandbox`
namespace (ports reach you through `kubectl port-forward`; TTL at most 8h).
`--profile storm-prod` / `storm-candidate` boot the published the-storm-server
image at its production / candidate pin and default to the cluster; use them to
check behavior as live tsmc runs it.

## Routing

| Task                                              | Read                             |
| ------------------------------------------------- | -------------------------------- |
| WorldEdit edits, region reads, snapshots, console | `references/commands.md`         |
| Actors and repeatable playtests                   | `references/actors-playtests.md` |
| A user-requested change on live tsmc              | `references/live.md`             |
| A build that should end up in a real place        | the `minecraft-building` skill   |

Key rules from those references:

- Each `we` call carries its own world and selection; trust its `changed N`,
  not WorldEdit's "blocks affected" text. Negative coordinates work as plain
  arguments; `toolkit mc <command> --help` shows usage.
- Take a snapshot before a large edit; `we-undo` only covers WorldEdit history.
- Actors cannot see chat or drive client UI; assert effects, not `ok: true`.
- On live, every write needs `--reason`; never scale the StatefulSet or touch
  mc-router annotations or the mining-reset lock.

## Clean up

Stop what you started: `toolkit mc sandbox down --all`, then
`toolkit mc daemon stop` if the daemon was started for this task. Report which
sandbox id and profile the evidence came from; a sandbox result is not
production behavior.
