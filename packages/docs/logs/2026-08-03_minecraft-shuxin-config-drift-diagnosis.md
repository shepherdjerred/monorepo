---
id: minecraft-shuxin-config-drift-diagnosis
type: log
status: complete
board: false
---

# minecraft-shuxin config-drift startup failure — diagnosis

## Symptom

`minecraft-shuxin-0` stuck in `Init:Error` / `CrashLoopBackOff`. Failing init
container is `check-config-drift` (exit 1), so `copy-plugin-configs` and the
server never run. Siblings `minecraft-sjerred-0` and `minecraft-tsmc-0` are
`Running`.

## Mechanism

`getMinecraftConfigDriftCheckInitContainer`
(`packages/homelab/src/cdk8s/src/misc/minecraft-drift-check.ts`) runs a busybox
init container that **byte-compares** (`cmp -s`) every repo-managed config
(ConfigMap projected at `/plugin-configs` and `/config`) against the persistent
volume (`/data/plugins`, `/data`). Any mismatch not in the `is_ignored()`
allowlist → prints `DRIFT DETECTED`, `exit 1`, pod refuses to start.

Design intent elsewhere in `minecraft-config.ts`: repo always wins
(`SYNC_SKIP_NEWER_IN_DESTINATION=false`); `copy-plugin-configs` `cp`s the
ConfigMap over `/data/plugins` unconditionally on every boot. So the drift check
is purely an alert that the PVC diverged — it does not change what gets applied.

## Finding

42 files reported as drifted. Pulled the live PVC files via a read-only
ephemeral container (`drift-reader`) attached to the failing pod (RWO
zfs-localpv refused a 2nd mount; node-debug blocked by PodSecurity; ephemeral
container reuses the existing mount). Parsed every file as YAML/JSON and
compared data structures (`scratchpad/compare.py`):

**42 / 42 are semantically identical to the repo. 0 real content changes.**

Every diff is cosmetic re-serialization the plugins perform when they load their
config on boot:

- indentation 2-space → 4-space (mcMMO — Bukkit `YamlConfiguration` rewrites the
  whole file), 14 mcMMO files
- single vs double quotes (`'{world}'` ↔ `"{world}"`), escaping
  (`'..."..."'` → `"...\"...\""`)
- trailing whitespace after null-valued keys (`donation-key:` → `donation-key: `)
- missing EOF newline (GSON/plugin writers)
- YAML block↔flow normalization (GriefPrevention, WanderingTrades)

Affected plugins: mcMMO, CoreProtect, Essentials, GravesX, GriefPreventionData,
LevelledMobs, LuckPerms, Sleeper, WanderingTrades, Geyser-Spigot.

## Root cause

The check is a byte comparison, which cannot distinguish "plugin reformatted the
file on load" from "human edited a value." These plugins rewrite their entire
config files into their own serialization every boot, so the byte-compare
false-positives on ~40 files. shuxin's committed configs are in hand/default-JAR
form (2-space, double quotes), never the plugins' on-disk form.

sjerred passes because it ships only 8 plugin config files (few of these
plugins). tsmc's relationship is not fully pinned (it also has mcMMO yet passes)
— likely its live PVC already round-trips; not required for the shuxin answer.

The `is_ignored()` allowlist has been patched file-by-file to chase this:
`commands.yml`, `spark/config.json`, `mcMMO/chat.yml`, and (yesterday, #1960)
`mcMMO/party.yml` — each commit titled "so shuxin starts." It cannot scale to
the ~40 files these plugins rewrite.

## Fix options (considered)

1. **Proper fix — make the check semantic.** Compare normalized YAML/JSON, not
   bytes (needs a parser in the init image; busybox has none — use a small
   yq/python image). Keep the genuinely runtime-mutated files
   (`server.properties`, `spigot.yml`, `paper-*.yml`, `Geyser config.yml`)
   ignored. Fixes the whole class for all servers; lets most of the current
   ignore list be removed. **← chosen and implemented.**
2. **Unblock shuxin now — normalize repo → live form.** Copy the plugin-written
   files back into `config/minecraft-shuxin/plugins/`, commit. Semantically a
   no-op; makes the byte-compare pass. Fragile to future plugin serialization
   changes. (Not needed — #1 makes shuxin's existing configs pass untouched.)
3. Expand `is_ignored()` to all 40 files — whack-a-mole, rejected.

## Implementation of #1 (semantic drift check)

Branch `fix/minecraft-config-drift-semantic`.

- **`misc/minecraft-config-drift-check.sh`** (new) — the check, extracted to a
  standalone POSIX script so it is unit-testable. Byte-compare fast path; on a
  mismatch, `.yml/.yaml/.json` are compared by parsed value (`yq -o=json
sort_keys(..)` → identical canonical string ⇒ reformat only, pass), and
  other files by CRLF/trailing-whitespace-normalized text. Trimmed
  `is_ignored()` to the files with real runtime value changes
  (`server.properties`, `spigot.yml`, `config/paper-*.yml`,
  `Geyser-Spigot/config.yml`); dropped `commands.yml`, `spark/config.json`,
  `mcMMO/chat.yml`, `mcMMO/party.yml` (now pass semantically). Parameterized
  `SRC DEST` pairs; production defaults `/plugin-configs→/data/plugins` and
  `/config→/data`.
- **`misc/minecraft-drift-check.ts`** — reads the `.sh` at synth and inlines it;
  init image switched `library/busybox` → `mikefarah/yq` (Alpine/busybox + yq).
- **`versions.ts`** — pinned `mikefarah/yq` (renovate-annotated docker digest).
- **`.mise.toml`** — added `yq = "4"` so the test's `yq` exists locally and in
  CI (`toolchain.sh` runtime-bootstraps it onto the still-pinned ci-base image).
- **`misc/minecraft-drift-check.test.ts`** — 11 cases: reformat-only
  yaml/json/text pass; real yaml/json/text value change fails and names the
  file; ignored-file real change passes; fresh PVC passes; malformed-on-volume
  fails; multi-pair run.

Validated against the captured live shuxin PVC: all 45 byte-different managed
files report `OK reformatted` / `IGNORED`, exit 0 — i.e. after deploy shuxin
boots without touching its committed configs. Confirmed identical behavior
inside the real `mikefarah/yq` busybox image.

## Session Log — 2026-08-03

### Done

- Diagnosed `minecraft-shuxin-0` `Init:Error`: `check-config-drift` fails on 42
  drifted plugin config files.
- Proved all 42 are cosmetic plugin re-serialization, 0 real edits (semantic
  YAML/JSON parse compare against live PVC files).
- Identified byte-compare as root cause; documented the file-by-file
  `is_ignored()` patching that can't keep up.
- Cleaned up: deleted read-only `drift-reader` ephemeral container (via pod
  delete; StatefulSet recreated the pod — still failing, unchanged availability).

### Remaining

- No fix applied. Decide between semantic-check (#1) and repo-normalize (#2),
  then implement in a worktree + PR (homelab code change).

### Caveats

- shuxin remains down (`Init:Error`) — this was diagnosis only.
- `scratchpad/live/` holds a copy of the live PVC configs used for comparison;
  session-scratch, not committed.

## Session Log — 2026-08-03 (implementation)

### Done

- Implemented fix #1 (semantic drift check) on
  `fix/minecraft-config-drift-semantic`:
  - `packages/homelab/src/cdk8s/src/misc/minecraft-config-drift-check.sh` (new)
  - `.../misc/minecraft-drift-check.ts` (read `.sh` at synth; image → yq)
  - `.../misc/minecraft-drift-check.test.ts` (new, 11 cases)
  - `packages/homelab/src/cdk8s/src/versions.ts` (pin `mikefarah/yq`)
  - `.mise.toml` (`yq = "4"`)
- Verified: typecheck, full cdk8s test suite (328 pass / 0 fail), the new test
  (11/11), eslint, prettier, shellcheck, and `bun run build` synth (manifest
  pins the yq image + inlines the semantic script). Confirmed against the real
  captured shuxin PVC (exit 0) and inside the yq image.

### Remaining

- Land the PR; on deploy/ArgoCD sync the `check-config-drift` container gets the
  new image + script and `minecraft-shuxin-0` boots. Verify the pod reaches
  `1/1 Running` post-deploy.
- The main-branch `ci-base` image will re-bake with `yq` via the standard
  `ci-base candidate` step after merge (in-PR runs bootstrap yq at runtime).

### Caveats

- Runtime-owned files (`server.properties`, `spigot.yml`, `paper-*.yml`,
  `Geyser-Spigot/config.yml`) stay ignored — Paper/Geyser write real values
  there, which the semantic check would (correctly) flag.
- Renovate will bump the pinned `mikefarah/yq` digest like any other image.
