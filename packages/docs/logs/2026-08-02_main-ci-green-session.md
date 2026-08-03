---
id: main-ci-green-session-2026-08-02
type: log
status: complete
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
servers. Validated live after merge: deleted all three pods, the
`DirectoryNotEmptyException` is gone, and the servers now reach
`Starting the Minecraft server...`.

### Minecraft fix part 2 — Java 25 (PR #1958)

Removing the config-sync crash revealed a second, previously-masked crash: the
server reached startup and died with `Minecraft 26.1 and newer requires running
the server with Java 25 or above` (exit 1). `versions.paper` is pinned to
`26.1.2` (needs Java 25) but `itzg/minecraft-server` was pinned to the `-java21`
variant. Renovate bumps the two via independent datasources (`custom.papermc` vs
`docker`), so the Java major drifted out of sync.

Fix: bump the image to the `java25` variant of the same itzg release
(`2026.7.2-java25`, digest verified with `crane`, multi-arch amd64/arm64/riscv64).
Smoke-tested live on **sjerred only**: patched its StatefulSet to java25 → the
pod reached `1/1 Running`, Paper 26.1.2 booted and all plugins (GravesX,
DiscordSRV, LuckPerms, EssentialsX, …) loaded. This confirms java25 clears the
startup crash on sjerred; shuxin and tsmc await the same post-deploy check (they
may hit server-specific plugin/config issues) — see Remaining.

## Session Log — 2026-08-02

### Done

- PR #1946 (merged): fix check-todos doc-id violations that turned main red.
- Confirmed PR #1920 (already merged) fixed the release-refiner blocker; main now
  clears verify → images → deploy → tofu → release-please.
- Cleared golink's stale ArgoCD failed-op operationally.
- Diagnosed minecraft `DirectoryNotEmptyException` to root cause on the live PVC.
- PR #1948 (merged): drop the counterproductive `mkdir -p /data/config` (partial).
- PR #1952 (merged): route `config/*` off itzg's `/config` sync via `/config-subdir`
  - init `cp`-seed; `set -e`; `${CFG_*}` guard. Validated live: no more
    `DirectoryNotEmptyException`.
- PR #1958 (merged): bump itzg image to java25 to match Paper 26.1.2. Deployed
  and validated live — **sjerred and tsmc both reach `1/1 Running`** on java25.
- **shuxin** had a second issue: its `check-config-drift` init container (from
  #1927) refused to start on `mcMMO/party.yml` drift (mcMMO reindents nested maps
  2→4 spaces on boot, same class as the already-ignored `chat.yml`). PR
  (fix/minecraft-shuxin-drift): add `./mcMMO/party.yml` to the drift-check
  `is_ignored()` allow-list.
- **tsmc** had a third issue: `FileSystemException: /data/plugins/DiscordSRV/
config.yml: Operation not permitted`. The file was **root-owned** on the PVC
  (historical cruft, alongside dozens of stale ConfigMap `..timestamp` artifact
  dirs), so itzg (uid 1000) could not overwrite it. Manifest is correct (same as
  sjerred). Fix was a one-time PVC cleanup: deleted the root-owned `config.yml`
  (+ the stale artifact dirs) via a uid-1000 debug pod; itzg recreates it as
  uid 1000. tsmc then reached `1/1 Running`. No code change needed — durable
  because itzg runs as uid 1000.
- PR #1960 (merged): the shuxin drift-check fix. Rolled all three servers onto the
  fix + java25; all reached Healthy (they then hibernated to replicas 0 = Healthy).
- Cleared **loki**'s stale ArgoCD `Operation=Failed` (same bound-PVC `volumeName`
  class as golink). This was the real reason the root `apps` app stayed
  `Progressing` even with every child Healthy — the app-of-apps health check
  treats a child with a failed operation as Progressing. After clearing it, `apps`
  → Healthy. (Restarting the argocd-application-controller did NOT clear it; the
  child-op sync did.)
- Cleared a **scout release orphan**: build #7794 (canceled on dotfiles commit
  `694fc85d5`, which doesn't touch scout) archived `<releaseInputDigest>/prod.json`
  then was canceled before writing `inputs/<id>.json`. Because scout content-
  addresses by `releaseInputDigest` (excludes the full commit sha) but
  `sameScoutReleaseContent` compares `sourceCommit`, the next build collided with
  the orphan and failed `immutable prod archive record does not match state`.
  Verified it was a true orphan (no input record, not in `versions/`, not the prod
  pin) and deleted only that identity prefix from `s3://scout-site-releases/`.
- **Main CI green confirmed: build #7807 (`25cd0cff2`) PASSED** — 22 jobs passed,
  0 failed; `argo: sync + wait` and `scout beta release` both green. First fully
  green main build in 30+ builds.

### Remaining

- **Durable scout orphan fix (recommended follow-up).** The rapid-merge
  cancellation pattern will recreate scout release orphans (archive prod → build
  canceled before the input record). Make the scout release step resilient — e.g.
  write the archive + input-state record atomically, or have `archiveFlavor`
  reconcile an orphaned record whose `inputs/<id>.json` is missing instead of
  failing closed. This changes the deliberately fail-closed release semantics, so
  it needs owner sign-off before implementing. Tracked in
  [`scout-release-orphan-atomic-archive`](../todos/scout-release-orphan-atomic-archive.md).
- **Paper 26.2 bump (held).** Smoke-tested live: Paper 26.2 boots but EssentialsX
  (core) and LevelledMobs fail — their version parsers reject the `26.x` scheme,
  and no 26.2-aware plugin releases exist yet. Revisit when the plugin ecosystem
  catches up; also fix the Renovate `customDatasources.papermc` mapping (returns
  version families, so Renovate can't surface the bump).

  <!-- temporal-agent-task
  {
    "title": "Recheck Paper 26.2 plugin compatibility (EssentialsX, LevelledMobs)",
    "provider": "claude",
    "mode": "report-only",
    "cron": "0 9 1 * *",
    "scheduleId": "scout-paper-26-2-plugin-recheck",
    "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
    "source": {
      "docPath": "packages/docs/logs/2026-08-02_main-ci-green-session.md"
    },
    "prompt": "Check whether EssentialsX (core) and LevelledMobs have shipped releases compatible with Paper 26.2's version scheme, and whether the Renovate customDatasources.papermc mapping now surfaces the 26.2 bump instead of collapsing it into a version family. Email whether the held Paper 26.2 upgrade is unblocked, with links/evidence (plugin release notes, Renovate PR if any). If both plugins are compatible, recommend proceeding with the bump and note that this recurring schedule should be paused."
  }
  -->

### Caveats

- Several fixes were operational (live-cluster), not code: golink/loki stale-op
  clears, the tsmc DiscordSRV PVC cleanup, the shuxin pod roll, and the scout
  orphan deletion. They are durable for the fixed condition but not re-applied by
  code; the scout orphan specifically WILL recur without the durable fix above.
- The systemic bound-PVC `volumeName` immutable-patch (golink, loki, minecraft)
  leaves stale `Operation=Failed` artifacts on otherwise-healthy apps. A global
  ArgoCD `ignoreDifferences` for PVC `/spec/volumeName` would stop them recurring.
- Minecraft servers hibernate at replicas 0 (mc-router); they only block the argo
  gate while woken+crashing. Something (likely the bluemap ingress) kept them
  woken through this session.
- Rapid successive merges to main cancel in-flight builds before the ~15-min
  deploy+argo train finishes; a fully-green main build needs a quiet window (#7807
  got one).
