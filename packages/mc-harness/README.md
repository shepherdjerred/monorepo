# @shepherdjerred/mc-harness

Runtime behind `toolkit mc`: disposable Minecraft sandboxes, the typed client
for the MCBridge Paper plugin, and the session daemon that holds them.

## Layout

| Path                        | What it is                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `src/protocol/`             | Zod-only contracts: the MCBridge wire API, daemon IPC, paths, protocol version             |
| `src/bridge/client.ts`      | `BridgeClient` — bearer-authenticated, every response validated against the contract       |
| `src/pins.ts`               | Pinned itzg image, Paper 26.2 build, WorldEdit and Citizens jars (url + sha256)            |
| `src/providers/docker/`     | Docker CLI wrapper, reusable Paper-container helpers, and the Docker sandbox provider      |
| `src/providers/kubernetes/` | Cluster sandbox provider: scoped kubectl, pod manifest, port-forward supervisor            |
| `src/sandbox/`              | Sandbox records (0600, hold secrets), profiles, staging, and the provider contract         |
| `src/playtest/`             | Scenario API (`define.ts`), the per-run child process, expectations and run reports        |
| `src/target.ts`             | `Target`: one server the harness acts on (bridge client + log tail)                        |
| `src/live/`                 | Live tsmc: cluster status, port-forward, write guard, Velero backups, journal and undo     |
| `src/daemon/`               | Unix-socket daemon: idle TTL, JSONL logs, sandbox lifecycle, target and playtest routes    |
| `src/protocol/build.ts`     | Build workspace files, the op log and manifest schemas (shared with toolkit `--record`)    |
| `src/build/`                | `toolkit mc build` CLI: capture, canvas, compile, run, render, lint, replay, promote, undo |
| `playtests/`                | The harness smoke scenario                                                                 |
| `evals/`                    | Agent eval suite (Codex/Claude tasks, graders, runner); manual, see `evals/README.md`      |

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

The `paper` profile boots the pinned image with Paper 26.2, WorldEdit, Citizens
(test actors), and the repo-built `MCBridge.jar` (build it with
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
at the version catalog's `/prod` and candidate pins with fixture credentials,
staging nothing: the image bakes Paper, every plugin and the owned config. It
needs an image that bakes MCBridge; earlier images never answer the bridge
health check.

The `storm-dev` profile adds the locally built `TheStorm.jar` (build it with
`bunx turbo run build --filter=@shepherdjerred/the-storm`), its required
LuckPerms and Multiverse, the repository-owned config with only the economy,
chat, tracks, towns and tickets modules on (agent, discord and world need
external services), and `TheStormMechanicsE2E.jar`, which runs the production
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
need a real client (dialogs, join, chat rendering) stay in the-storm's
Mineflayer E2E suite.

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
- **Judge** (`judge <a> <b> [--model id]`) asks a vision model to compare two
  renders on the eight rubric aspects, once in each order; when the orderings
  disagree the verdict is a tie. It defaults to a non-OpenAI model so it does
  not share the build agent's biases, and needs that provider's credential in
  the environment. The E2/E5 eval graders add its verdict against a library
  reference as a note when a credential is present; it never affects pass or
  fail.

The CLI reaches servers only through the daemon socket, so the daemon remains
the sole owner of sandboxes and bridge tokens.

## Live minecraft-tsmc

`--target live` (never inferred) makes the daemon's `LiveService`
(`src/live/`) the target. It reads cluster state as the
`mc-sandbox:mc-harness` ServiceAccount (`kubectl --as`): the StatefulSet, pod
`minecraft-tsmc-0` and the `sjer.red/mining-reset-lock` annotation. An asleep
or locked server is a 409 refusal; the harness never scales, patches or
annotates anything. When usable, it supervises a `kubectl port-forward` to the
pod's MCBridge port 25580. The bridge token comes only from the daemon's
`MC_BRIDGE_TOKEN` environment (from the `storm-brain` 1Password item). Logs come
from bridge `log` events, because the ServiceAccount has no `pods/log` there.

Every write route goes through `guarded()` (`src/daemon/live-routes.ts`).
Sandbox writes run directly. Live writes are assessed and authorized by the
pure guard (`src/live/guard.ts`) from the `x-mc-*` request headers (reason,
allow-players, confirm-dangerous, affects):

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
  `--allow-players`; NPCs are ignored.

Each attempt that passes the guard is appended to
`~/.toolkit/mc/journal/live/<date>.jsonl` with its reason, tier, box, humans
online, backup and snapshot id, whether or not it succeeds. `live undo` is
last-in-first-out over overlapping boxes. `live backup` creates a Velero
`Backup` shaped like the mining reset's.

Operator steps: the wiki how-to "Operate The Storm with the agent harness".

## Commands

```bash
bun run typecheck
bun run test
bun run lint
bun run daemon     # run the daemon in the foreground (toolkit mc daemon start detaches it)
bun run evals -- --agent codex --tasks e1,e4   # agent evals (Docker + model spend; see evals/README.md)
```
