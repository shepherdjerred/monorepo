# @shepherdjerred/mc-harness

Runtime behind `toolkit mc`: disposable Minecraft sandboxes, the typed client
for the MCBridge Paper plugin, and the session daemon that holds them.

## Layout

| Path                        | What it is                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/protocol/`             | Zod-only contracts: the MCBridge wire API, daemon IPC, paths, protocol version                  |
| `src/bridge/client.ts`      | `BridgeClient` — bearer-authenticated, every response validated against the contract            |
| `src/pins.ts`               | Pinned itzg image, Paper 26.2 build and plugin jars (url + sha256, as server/plugins.json)      |
| `src/providers/docker/`     | Docker CLI wrapper, reusable Paper-container helpers, and the Docker sandbox provider           |
| `src/providers/kubernetes/` | Cluster sandbox provider: scoped kubectl, pod manifest, port-forward supervisor                 |
| `src/sandbox/`              | Sandbox records (0600, hold secrets), profiles, staging, and the provider contract              |
| `src/playtest/`             | Scenario API (`define.ts`), the per-run child process, expectations and run reports             |
| `src/target.ts`             | `Target`: one server the harness acts on (bridge client + log tail)                             |
| `src/live/`                 | Live tsmc: cluster status, port-forward, write guard, Velero backups, journal and undo          |
| `src/files/`                | Read-only `/data` access over `docker exec` / scoped `kubectl exec` (`toolkit mc files`)        |
| `src/daemon/`               | Unix-socket daemon: idle TTL, JSONL logs, sandbox lifecycle, target, playtest and client routes |
| `src/protocol/build.ts`     | Build workspace files, the op log and manifest schemas (shared with toolkit `--record`)         |
| `src/build/`                | `toolkit mc build` CLI: capture, canvas, compile, run, render, lint, replay, promote, undo      |
| `playtests/`                | The harness smoke scenario                                                                      |
| `evals/`                    | Agent eval suite (Codex/Claude tasks, graders, runner); manual, see `evals/README.md`           |

`toolkit` is compiled to a single binary and may import only `src/protocol/*`;
an architecture boundary keeps that directory free of daemon, provider, and
bridge-client code. The-storm's E2E harness reuses `providers/docker/` for its
own Paper container.

## Bridge contract

`src/protocol/bridge.ts` mirrors MCBridge (`packages/the-storm/plugin/bridge`).
Routes live under `/v1` and require `Authorization: Bearer <MC_BRIDGE_TOKEN>`;
schemas are strict so plugin/harness skew fails as a `contract` error instead of
a misread field. Event reads are oldest-first and accept at most 500 events per
page; live log tails paginate those bounded pages to cover the 2,000-event ring
window. Region reads return a palette plus base64 little-endian uint32 indices
in YZX order.

## Sandboxes

The `paper` profile boots the pinned image with Paper 26.2, WorldEdit, Citizens
(test actors), and the repo-built `MCBridge.jar` (build it with
`mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble`). The pinned
Paper jar and plugin jars are downloaded once on the host (sha256-verified)
and seeded into the container, which runs the jar as `TYPE=CUSTOM`; the
`PAPER` type would call the PaperMC API on every boot. Once Paperclip's warm
cache under `~/.toolkit/mc/cache/paperclip` holds the patched Mojang jar,
server bootstrap needs no downloads. Plugins such as Citizens may still
download their declared runtime libraries. Worlds are
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

### Cluster sandboxes

`--provider kubernetes` (or a `storm-prod` / `storm-candidate` profile, which
default to it) runs the sandbox as a pod in the homelab's `mc-sandbox`
namespace. Every call is `kubectl --context <mcKubeContext> --as
system:serviceaccount:mc-sandbox:mc-harness -n mc-sandbox`, so the namespace's
RBAC bounds what the harness can do; `mcKubeContext` (env `MC_KUBE_CONTEXT` or
`~/.toolkit/config.toml`) defaults to `admin@torvalds` and is never inferred
from kubectl's current context.

The pod (`src/providers/kubernetes/pod-manifest.ts`) is built to pass the
namespace's admission policy: harness labels and an expiry annotation,
`activeDeadlineSeconds` at the TTL plus ten minutes (at most 8 h, so the
cluster kills a forgotten pod even without the daemon), `batch-low` priority on
the CI node, bounded requests and limits on every container, `emptyDir`
volumes only, Pod Security "restricted", and digest-pinned images. Profiles
that stage plugins get a `stage` init container: the provider copies the staged
`/plugins` tree and `/data` seed files in with `kubectl cp`, then touches a
ready file. The game, RCON and bridge ports reach the laptop through a
supervised `kubectl port-forward` that restarts with backoff and is re-attached
(with new local ports) after a daemon restart. Reaping reads the pods' expiry
annotations; records whose pod disappeared are dropped.

`storm-prod` and `storm-candidate` boot `ghcr.io/shepherdjerred/the-storm-server`
at the version catalog's `/prod` and candidate pins with fixture credentials.
The image bakes Paper, every plugin, and owned config; the harness stages
a config overlay that enables the companion module and its local dependencies,
while disabling RWF, which requires the provisioned `rwf` world and production
recording salt. Docker and Kubernetes mount the overlay at the config file path,
leaving the image's baked plugins visible. The overlay uses a clearly fake RWF
salt and does not copy production world or plugin data. Both profiles set an unreachable Flipt
bootstrap (`FLIPT_URL=http://127.0.0.1:9`, `FLIPT_ENVIRONMENT=beta`), so
companions fail closed and do not spawn or act in the disposable world. The
image must bake MCBridge; earlier images never answer the bridge health check.

Each published pin also requires a digest-specific module schema snapshot in
`src/sandbox/storm.ts`. When advancing a pin, inspect that exact image's
`/plugins/TheStorm/config.yml` and register its keys. Both production and
candidate profiles are checked by the harness tests; an unknown digest fails
instead of borrowing the current checkout's schema.

The locally built `TheStormFixtures.jar` also prepares the named worlds and
geometry a fresh volume requires. Both providers mount it as a single file,
preserving the image's baked plugin tree. Build it with
`bunx turbo run build --filter=@shepherdjerred/the-storm` before starting either profile.

The `storm-dev` profile adds the locally built `TheStorm.jar` (build it with
`bunx turbo run build --filter=@shepherdjerred/the-storm`), the plugins
its `paper-plugin.yml` requires (LuckPerms, CoreProtect, Multiverse; Citizens
is already staged), `TheStormFixtures.jar` to prepare the protected arena worlds,
and the inert local Flipt bootstrap required during plugin startup
(`FLIPT_URL=http://127.0.0.1:9`, `FLIPT_ENVIRONMENT=beta`). Rollout checks
therefore fail closed without requiring credentials or a running Flipt service,
the repository-owned TheStorm and Citizens config with
only the economy, mail, chat, tracks, towns and tickets modules on (agent,
discord and world need external services), and `TheStormMechanicsE2E.jar`, which runs the production
mechanics module and builds its bridge and super-push fixtures at x 400-415.

## Actors

With Citizens installed, MCBridge exposes `/v1/actors`: player NPCs in a
private in-memory Citizens registry that keep their own chunk loaded and
vanish when the bridge stops. They never join, so they are absent from
`/v1/players` and fire no `PlayerJoinEvent`. Without Citizens the routes answer
`unsupported` and `/v1/info` omits the `citizens` capability. Verified on
Paper 26.2 with Citizens 2.0.44:

| Action    | Mechanism                                                           | Observed                                                    |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `goto`    | Citizens navigator; completes on arrival, cancelled on timeout      | arrives; unreachable targets time out                       |
| `command` | `PlayerCommandPreprocessEvent`, then `performCommand`               | `command` event; op commands run                            |
| `chat`    | `Player#chat`                                                       | `AsyncChatEvent` (`chat` event)                             |
| `break`   | `Player#breakBlock`                                                 | `BlockBreakEvent`; survival drops the item                  |
| `place`   | set block with physics, `BlockPlaceEvent`, revert when cancelled    | `BlockPlaceEvent`; redstone updates                         |
| `use`     | `PlayerInteractEvent` (`RIGHT_CLICK_BLOCK`, hand) + vanilla toggles | levers power lamps, doors open both halves, buttons release |
| `attack`  | `LivingEntity#attack`                                               | `EntityDamageByEntityEvent` (`damage` event)                |

Citizens discards messages sent to an actor, so scenarios assert on world state
and the event stream. A `use` that a listener denies still answers `ok: true`:
plugins also cancel clicks they handled (Storm's sign mechanisms do). Flows that
need a real client (dialogs, join, chat rendering) use the real client below
or the-storm's E2E suite.

## Real client

`toolkit mc client` runs the-storm's Fabric preview client
(`packages/the-storm/client`, Minecraft 26.2) against a sandbox. The daemon
owns each client: it spawns `mise exec -- gradle runClient` from the
repository with a private bootstrap (control socket, artifacts dir, server
address) and a throwaway game dir, waits until the player is in the world,
then speaks the client's newline-delimited JSON protocol for `status`, `look`,
`move` (the protocol's `input`), `hotbar`, `use`, `attack`, `release`,
`command`, and `capture`. The harness never imports the-storm; it only starts
the process.

|          | Citizens actor (`toolkit mc actor`)          | Real client (`toolkit mc client`)                             |
| -------- | -------------------------------------------- | ------------------------------------------------------------- |
| Is       | Server-side NPC driven through MCBridge      | A rendered game client that joins over the network            |
| Joins    | Never (no `PlayerJoinEvent`, not in players) | Yes, as an offline-mode player named with `--name`            |
| Acts by  | Server API calls (`place`, `break`, `goto`)  | Keyboard-style input on the crosshair, as a player would      |
| Sees     | Observation JSON                             | `capture` screenshots of the rendered frame plus `status`     |
| Cost     | Milliseconds; any number; headless           | ~15–30s to join, a JVM each; needs a desktop session and Java |
| Targets  | Sandboxes and live (guarded)                 | Sandboxes only; tsmc is online-mode                           |
| Best for | Scripted playtests, block-level assertions   | What players see: HUD, dialogs, rendering, client-side flows  |

The client accepts only a `127.0.0.1` server, which matches Docker sandboxes
and cluster sandboxes (through the daemon's port-forward). `--op` and
`--game-mode` apply through the bridge console after it joins. Stopping a
sandbox stops its clients, and so does stopping the daemon. Each session writes
`client.log`, `commands.jsonl`, and captures under
`~/.toolkit/mc/clients/<name>-<started>/`; `capture --out f.png` copies the PNG
out. Verify world effects with `toolkit mc region read` rather than trusting a
screenshot alone.

Actors are Citizens NPCs, so Storm's `Humans.isHuman()` (no `NPC` metadata)
filters them out of most Storm listeners: towns, economy, shops, quests,
tracks, arena and similar flows ignore an actor exactly as they ignore story NPCs. `rwf` only excludes
its own `rwfbots` registry, so it counts harness actors as players. Test those
listener paths with a real client, not an actor.

## Playtests

A playtest file default-exports `defineScenario({...})` from
`@shepherdjerred/mc-harness/playtest/define.ts`: required profiles, plugins and
capabilities, actors, an optional region, `setup` and `run`. `run` receives
`command`, `we`, actor handles (actions throw when they do not take effect;
`attempt` returns instead), `step`, events, and `expect` (`block`, `command`,
`event`, `chat`, `log`, `inventory`, `that`).

`POST /playtests` loads each file in a child process, creates a sandbox from
the first scenario's profile unless a target is given, and runs each file in its
own child process, killed 90 s past its `timeoutMs`. Each run writes
`~/.toolkit/mc/runs/<runId>/`: `report.json` (steps, assertions, and on failure
every actor's observation plus event and log tails), `events.jsonl`,
`server.log`, and `region-before/after.schem`. Exit codes: 0 passed, 1 failed,
2 errored or timed out. Playtests run on sandboxes only.

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
- **Render** draws a contact sheet of the canvas site, or of a region inside
  it (`render <dir> <x1,y1,z1> <x2,y2,z2>`) so map-scale builds can be
  reviewed one district at a time.
- **Import** turns a `.litematic`, `.schem` or OBJ mesh into a schematic
  under `schematics/`, appends a paste op (`source` `import:<sha>`), lints it
  and renders a preview.
- **Replay** proves the log is deterministic on a fresh seeded sandbox. Random
  WorldEdit `%` patterns are not, so promote never depends on replaying ops.
- **Promote** checks the target still matches `siteHash`, requires the dry
  run's `planHash`, snapshots the box for undo, pastes `expected.schem`, and
  verifies it cell by cell. The journal (`~/.toolkit/mc/journal/<target>/`)
  records the snapshot id; **undo** restores it last-in-first-out.
- **Library** (`library ls|search|show|use`) browses mc-build's curated
  programs; `use` copies one over an untouched scaffold `build.ts` (an edited
  one needs `--force`).
- **Components** (`component ls|search|show|render|propose`) browse the shared
  helpers programs import and harvest new ones: `propose <dir> <file> --name
n --description d` copies a self-contained build helper into
  `packages/mc-build/components/<name>/`, writes `meta.json`, derives a demo
  from the build program, renders `demo.png` and prints the review checklist
  (it refuses to overwrite).
- **Judge** (`judge <a> <b> [--rubric micro|map] [--model id]`) asks a vision
  model which of two judge sheets is the better build, once in each order;
  when the orderings disagree the verdict is a tie, and no scores come back
  from a comparison. `judge --absolute <a> [--rubric micro|map]` scores one
  sheet 0–5 per rubric axis (functional axes first, the overall aesthetic
  question last and separately, so it cannot halo the rest). Both default to
  `gpt-6.1-sol` and need `OPENAI_API_KEY` in the environment (another
  provider's model needs that provider's key). A PNG argument is taken as a
  judge sheet (`scripts/render.ts --judge-sheet`); a build directory is
  judged by a judge sheet of the rubric rendered from its frozen canvas
  result (`expected.json`, from `build run`) and kept under `<dir>/judge/`,
  where the verdict is written too. Standalone PNGs compared with a build
  directory are copied there by content hash before judging, so changing or
  deleting the original cannot alter the recorded evidence. The build graders
  record the library comparison in the eval report; looks are rated by the
  bench (`evals/README.md`), never by pass/fail.

The CLI reaches servers only through the daemon socket, so the daemon remains
the sole owner of sandboxes and bridge tokens.

## Live minecraft-tsmc

`--target live` (never inferred) makes the daemon's `LiveService`
(`src/live/`) the target. It reads cluster state as the
`mc-sandbox:mc-harness` ServiceAccount (`kubectl --as`): the StatefulSet, pod
`minecraft-tsmc-0`, the `sjer.red/mining-reset-lock` annotation, and the
`sjer.red/world-restore-lease` annotation. An asleep or locked server is a 409
refusal, including a ready restoration acceptance pod; the harness never scales, patches or
annotates anything. When usable, it supervises a `kubectl port-forward` to the
pod's MCBridge port 25580. The bridge token comes only from the daemon's
`MC_BRIDGE_TOKEN` environment (from the `storm-brain` 1Password item). Logs come
from bridge `log` events, because the ServiceAccount has no `pods/log` there.

Every write route goes through `guarded()` (`src/daemon/live-routes.ts`).
Sandbox writes run directly. Live writes are assessed and authorized by the
pure guard (`src/live/guard.ts`) from the `x-mc-*` request headers (reason,
allow-players, allow-protected, confirm-dangerous, affects):

- **Tier 0**: commands and actor moves, journaled only.
- **Tier 1**: WorldEdit, paste, snapshot restore and actor block actions. The
  write's box is snapshotted on the bridge before it runs, so
  `live undo` can restore it.
- **Tier 2**: regions over `mcLiveMaxRegionVolume` and dangerous commands.
  These also need a clean completed Velero backup covering `minecraft-tsmc`
  newer than `mcLiveBackupMaxAgeHours`; dangerous commands also need
  `--confirm-dangerous`.

The guard refuses outright:

- console block commands, which could not be undone;
- worlds outside `mcLiveWorlds` (`mining` is rejected at config load);
- boxes over the snapshot limit, and selection-less WorldEdit shapes without
  `--affects`;
- humans inside the box. Humans within `mcLiveNearPlayerRadius` need
  `--allow-players`; NPCs are ignored;
- boxes intersecting `mcLiveProtectedRegions` (by default the Zombies
  settlement in `world`, x 1712-1871, z 2128-2287) without `--allow-protected`.

Each attempt that passes the guard is appended to
`~/.toolkit/mc/journal/live/<date>.jsonl` with its reason, tier, box, humans
online, backup and snapshot id, whether or not it succeeds. `live undo` is
last-in-first-out over overlapping boxes. `live backup` creates a Velero
`Backup` shaped like the mining reset's.

Operator steps: the wiki how-to "Operate The Storm with the agent harness".

## Plugin data

`toolkit mc files` pulls files off a sandbox or live tsmc without touching the
server: `ls` and `get` for any allowlisted path, and `rwf ls|get` for rwf match
recordings (`plugins/TheStorm/rwf-recordings/yyyy/MM/dd/<matchId>.rwfrec.gz`)
and rwfbots decision traces (`plugins/TheStorm/rwfbots-traces/<matchId>.gz`),
with `--gunzip` to decompress while saving.

- Paths are relative to `/data` and confined to `plugins/TheStorm/**`,
  `logs/**` and region folders: `<world>/dimensions/<ns>/<dim>/region/**`
  (Minecraft 26.x, e.g. `world/dimensions/minecraft/overworld/region`) and the
  legacy `<world>/region/**`. Absolute paths and `..` are rejected; the daemon
  also resolves the path inside the server and refuses a symlink that leads
  elsewhere.
- Only `test`, `realpath`, `find` and `cat` run in the server, through
  `docker exec` or `kubectl exec` as the scoped mc-harness ServiceAccount
  (`pods/exec` on the sandbox pod or `minecraft-tsmc-0`, container
  `minecraft-tsmc`). Live reads need a running pod but no bridge token, and
  the mining-reset lock does not block them.
- The daemon writes the file itself (absolute `--out`, never overwritten
  without `--force`) and returns its size and sha256.

## Commands

```bash
bun run typecheck
bun run test
bun run lint
bun run daemon     # run the daemon in the foreground (toolkit mc daemon start detaches it)
bun run evals -- --agent codex --tasks e1,e4   # agent evals (Docker + model spend; see evals/README.md)
```
