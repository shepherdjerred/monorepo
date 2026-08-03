---
id: main-ci-green-session-2026-08-02
type: log
status: in-progress
board: false
---

# Get main CI green — session log (2026-08-02)

Goal: get Buildkite `main` green without cutting quality. Main had not fully
passed in 30+ builds; each build either failed at an early gate or was canceled
by the next rapid merge before completing.

## What was wrong and what was done

### 1. `check-todos` regression (the acute main-red cause) — FIXED

Commit `efcbda83f` pushed two session logs straight to `main` that violated the
docs-board `check-docs` invariants, failing the `verify` lane:

- `logs/2026-08-02_main-ci-red-diagnosis.md` reused `id: main-ci-red-diagnosis`
  (already owned by the 2026-08-01 log).
- `logs/2026-08-02_syncthing-macbook-offline-diagnosis.md` used an `id` with
  underscores (fails the `^[a-z0-9][a-z0-9-]*$` pattern).

Fix: unique kebab-case ids. **PR #1946** (merged). Verified `bun run check-todos`
→ `1107 Markdown documents, all OK`.

### 2. Release-refiner `api_error_status: null` — already fixed

The prior main-red cause (release-please refiner Zod schema rejecting
`api_error_status: null`) was already fixed and merged in **PR #1920**
(`a84d624fa`). With #1946 + #1920 in, main clears verify → images → deploy →
tofu → **release-please** (all confirmed green on build #7749).

### 3. `argo: sync + wait` gate — pre-existing homelab health debt surfaced

Once the early gates passed, builds reached `argo: sync + wait` for the first
time in 30+ builds, exposing:

- **golink**: a stale ArgoCD `Operation=Failed` on an otherwise Synced/Healthy
  app (bound-PVC `volumeName` is immutable, so a past sync's PVC patch failed and
  froze). Cleared operationally with `argocd app sync golink` (→ Succeeded). It
  stays cleared because reconcile skips Synced apps.
- **minecraft-{sjerred,shuxin,tsmc}**: all three CrashLoopBackOff, making their
  apps `Progressing`, which bubbles up (app-of-apps health) to the root `apps`
  app and blocks `tree-health-wait apps`.

### Minecraft root cause (verified on the live PVC)

Mounted `datadir-minecraft-sjerred-0` in a read-only debug pod on torvalds
(RWO allows multiple pods per node; scaled the STS to 0 to free the attachment):

1. The `copy-plugin-configs` init container's `rm -rf /data/config` **works**
   (the debug pod removed it cleanly with the same uid/fsGroup).
2. itzg's **main** container then regenerates
   `/data/config/{paper-global,paper-world-defaults}.yml` during Paper setup
   (owned by uid 1000, mtime _after_ the init `rm`).
3. itzg's `sync /config → /data` does a directory **move** of the `/config/config`
   subdir onto the now-non-empty `/data/config` → `DirectoryNotEmptyException`.

So the init `rm` can never win (itzg repopulates `/data/config` after init,
before the sync). **PR #1948** (drop the pointless `mkdir -p /data/config`) was
necessary but **insufficient** — confirmed: fresh pods still crashed.

### Minecraft fix — PR #1952

Take the `config/*` files off itzg's `/config` sync entirely: mount them at
`/config-subdir` and seed them into `/data/config` via the init container's
`cp`-merge — the same bypass plugin configs already use for this identical itzg
bug. With no `config/` subdir left in `/config`, itzg never attempts the failing
move, so the crash is eliminated regardless of itzg's config-generation ordering.
Flat configs (`server.properties`, `bukkit.yml`, …) stay on itzg's sync.

Codex review gate (3 P2s) addressed in the same PR:

- `set -e` in the init script so a failed seed/copy aborts instead of booting
  with Paper defaults.
- Synthesis-time guard rejecting `${CFG_*}` placeholders in `config/*` files
  (they are seeded via raw `cp`, bypassing itzg interpolation; none use
  placeholders today).
- This session log.

Verified: tsc + eslint clean; rendered manifests show 0 `config/` items under any
`/config` mount and the new `/config-subdir` mount + init seed for all three
servers.

## Session Log — 2026-08-02

### Done

- PR #1946 (merged): fix check-todos doc-id violations that turned main red.
- Confirmed PR #1920 (already merged) fixed the release-refiner blocker; main now
  clears verify → images → deploy → tofu → release-please.
- Cleared golink's stale ArgoCD failed-op operationally.
- Diagnosed minecraft `DirectoryNotEmptyException` to root cause on the live PVC.
- PR #1948 (merged): drop the counterproductive `mkdir -p /data/config` (partial).
- PR #1952 (open): route `config/*` off itzg's `/config` sync via `/config-subdir`
  - init `cp`-seed; `set -e`; `${CFG_*}` guard. The real minecraft fix.

### Remaining

- Merge #1952 after CI + review gate pass.
- **Validate on live pods post-merge**: delete a minecraft pod, confirm it starts
  Healthy (no `DirectoryNotEmptyException`), and that `apps` returns to Healthy.
- Confirm a `main` build then completes the `argo: sync + wait` gate green (needs
  a quiet window — rapid merges keep canceling in-flight main builds mid-argo).

### Caveats

- The minecraft fix is verified at the manifest level and by root-cause analysis,
  but itzg's runtime ordering (whether it preserves the init-seeded paper config
  vs. regenerating it) is only fully confirmable post-deploy. The crash is
  eliminated either way; only _which_ paper config wins needs the live check.
- Minecraft servers hibernate at replicas 0 (mc-router); they only block the argo
  gate while woken+crashing. Something (likely the bluemap ingress) kept them
  woken through this session.
- Rapid successive merges to main cancel in-flight builds before the ~15-min
  deploy+argo train finishes; a fully-green main build needs a quiet window.
