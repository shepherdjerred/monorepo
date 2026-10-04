---
name: minecraft-harness
description: Drive disposable Minecraft (Paper 26.2) sandboxes through `toolkit mc` — run console commands, edit with WorldEdit, read exact block states, snapshot and restore regions, and watch events and logs. Use to try out a plugin change, prototype a build, or validate a gameplay idea in a throwaway server.
allowed-tools:
  - Bash
  - Read
---

# Minecraft harness

`toolkit mc` talks to the mc-harness daemon, which runs Paper 26.2 sandboxes in
local Docker containers with WorldEdit and the repo's MCBridge plugin. Every
world operation goes through MCBridge, so reads return exact 26.2 block states
and WorldEdit runs as a named actor (`agent:<session>`) with its own undo
history.

## Safety

- Sandboxes only. There is no live-server target yet; `--target live` fails.
- A sandbox is disposable: it is removed at its TTL (default 2h) or when the
  daemon stops, unless created with `--keep`.
- Ports are bound to `127.0.0.1`. Never print the bridge token or RCON password
  from `~/.toolkit/mc/sandboxes/*/record.json`.

## Start

```bash
mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble   # build MCBridge.jar
toolkit mc daemon start                                             # optional: any mc command auto-starts it
toolkit mc sandbox up --world void      # or --world flat; first boot downloads Paper
toolkit mc info                          # versions, worlds, plugins, capabilities
```

`sandbox up` prints the sandbox id and the game port, so a person can join with
a 26.2 client at `127.0.0.1:<port>` (offline mode). With one sandbox running,
commands target it automatically; otherwise pass `--target <id>`.

## Edit with WorldEdit

Each `we` call carries its own world and selection; nothing depends on earlier
calls. `--pos1/--pos2` set the selection and `--at` sets the placement point
(for `//sphere`, `//cyl`, `//pyramid`, `//generate` and other commands that
build at a position).

```bash
toolkit mc we --world world --pos1 0,-60,0 --pos2 10,-56,10 "//set 70%stone_bricks,30%cracked_stone_bricks"
toolkit mc we --world world --pos1 0,-60,0 --pos2 10,-56,10 "//walls oak_planks"
toolkit mc we --world world --at 5,-50,5 "//sphere glass 4"
toolkit mc we-undo --steps 1
```

Use `--session <name>` to keep separate undo histories. A failed op exits 1 and
prints the WorldEdit error. Trust `changed N` on each op (blocks that really
changed), not WorldEdit's "blocks affected" text. Negative coordinates work as
plain arguments; `toolkit mc <command> --help` shows a command's usage.

## Look and verify

```bash
toolkit mc region read --world world 0,-60,0 10,-50,10           # palette counts
toolkit mc region read --world world 0,-60,0 10,-50,10 --out region.json
toolkit mc cmd "execute if block 0 -60 0 minecraft:stone_bricks"
```

`region read --out` writes the palette plus base64 little-endian uint32 indices
in YZX order (`index = (y*sizeZ + z)*sizeX + x`).

## Snapshot and restore

```bash
toolkit mc snapshot create --world world 0,-60,0 10,-50,10 --label before-roof
toolkit mc snapshot ls
toolkit mc snapshot restore <id>       # pastes it back, air included
toolkit mc snapshot get <id> --out before.schem
toolkit mc paste --world world --file before.schem --at 20,-60,0 --rotate 90
```

Take a snapshot before a large edit; `we-undo` only covers WorldEdit history.

## Building

For anything that should end up in a real place (a house, a garden, terrain),
use the `minecraft-building` skill: `toolkit mc build` captures the site,
authors on a canvas (`--record <dir>` on `we`, `paste` and `cmd` appends to the
op log), renders, lints, replays and promotes with undo.

## Console, events, logs

```bash
toolkit mc cmd "time set noon"
toolkit mc players
toolkit mc events --since <cursor>     # chat, commands, joins, deaths, plugin log lines
toolkit mc logs -n 100                 # container console tail
```

## Actors and playtests

Actors are Citizens player NPCs (`paper` and `storm-dev` profiles). Use them to
exercise plugin behavior as a player would:

```bash
toolkit mc actor spawn alice --at 0,-60,0 --op
toolkit mc actor act alice goto --pos 5,-60,5
toolkit mc actor act alice use --pos 4,-60,1     # fires PlayerInteractEvent
toolkit mc actor act alice command /spawn
toolkit mc actor observe alice                   # inventory, nearby, recent events
```

For a repeatable check, write a scenario (`toolkit mc playtest new <name>
--dir packages/<pkg>/playtests`) and run it; with no `--target` a fresh sandbox
is created from the scenario's profile and removed afterwards:

```bash
mise exec -- gradle -p packages/the-storm/plugin assemble   # MCBridge + TheStorm jars
toolkit mc playtest run packages/the-storm/playtests
toolkit mc playtest show <run-id>                           # steps, failed assertions, tails
```

On failure read `report.json`: the failing step, each actor's observation and
the event tail usually explain it. Limits: actors receive no chat or messages,
never join, and cannot drive client UI (dialogs, inventories); prove those with
the-storm's Mineflayer E2E suite. A denied `use` still reports `ok: true`, so
assert effects. Playtests never run against live servers.

## Clean up

Stop what you started: `toolkit mc sandbox down --all`, then
`toolkit mc daemon stop` if the daemon was started for this task. Report which
sandbox id and profile the evidence came from; a sandbox result is not
production behavior.
