---
id: log-2026-06-06-pokemon-crashloop-stale-image-logger
type: log
status: complete
board: false
---

# Pokemon (discord-plays-pokemon) k8s crash loop — live fix + code change

## Symptom

`pokemon` deployment in namespace `pokemon` was in `CrashLoopBackOff`. Container
`main` exited repeatedly. First visible error:

```
EACCES: permission denied, mkdir 'logs'
  at _createLogDirIfNotExist (winston/.../transports/file.js:791)
  at new File (.../file.js:94)
  at .../packages/backend/src/logger.ts:7
```

## Root causes (two, stacked)

1. **winston File transport crashes on a non-writable CWD.**
   `packages/backend/src/logger.ts` configured a `File` transport at
   `logs/application.json`. winston `mkdir`s the log dir at construction. The
   container runs as uid/gid 1000, but the app's working directory (image
   `WorkingDir`) is owned by root and not writable → `EACCES` → process exits
   before anything else runs. Nothing ever consumed `logs/application.json`; a
   `Console` transport was already present and k8s captures stdout.

2. **The pinned image was stale and predated the headless rewrite.**
   `versions.ts` pinned `2.0.0-3412`. Inspecting image configs with `crane`:
   - `2.0.0-3412`: `WorkingDir=/workspace/packages/discord-plays-pokemon/packages/backend`, entrypoint `bun run src/index.ts`, **old config schema** (wanted `stream.userbot.username/password`, `game.browser`, rejected `wasm_path`/`save_path`).
   - `2.0.0-3436` (newest): `WorkingDir=/workspace/packages/discord-plays-pokemon`, entrypoint `bun packages/backend/src/index.ts`, **current headless schema** — matches the source `ConfigSchema` and the 1Password `config.toml` (`userbot.token`, `stream.video`, `game.wasm_path/save_path`).

   The deployment's `APP_ROOT` (`/workspace/packages/discord-plays-pokemon`) and
   its config/saves mount paths were written for the 3436-style image, but the
   pin lagged at 3412 (pokemon image is "not managed by renovate", so it never
   got bumped with the rest). Result: with 3412, config.toml resolved to the
   wrong path, then failed schema validation.

## Live fix (kubectl, to stop the bleeding)

Iteratively patched the live deployment to the intended end state and verified:

- image → `2.0.0-3436@sha256:7c35...`
- config/saves mounts kept at `APP_ROOT` (correct for 3436)
- added writable `emptyDir` mounted at `${APP_ROOT}/logs`

Confirmed `APP_ROOT` is **not** writable: removing the logs emptyDir reproduced
the same `mkdir 'logs'` EACCES on 3436 too, proving the File transport is a real
bug independent of image version. With the emptyDir re-added, pod went
`Running 1/1`: discord bot logged in, emulator booted, stream account connected,
web server up, "ready to handle commands". (ArgoCD app uses `automated: {}`
without `selfHeal`, so the manual patches persist until the next chart sync.)

## Code change (durable)

1. `packages/discord-plays-pokemon/packages/backend/src/logger.ts` — removed the
   `File` transport; log to stdout only via the existing `Console` transport
   (keeps `handleExceptions`/`handleRejections`). Real fix for the EACCES crash;
   idiomatic for containers.
2. `packages/homelab/src/cdk8s/src/versions.ts` — bumped pin
   `2.0.0-3412` → `2.0.0-3436` (+ sha) so the deployed image matches the current
   code and config schema.
3. `packages/homelab/src/cdk8s/src/resources/pokemon.ts` — added a writable
   `logs` emptyDir mounted at `${APP_ROOT}/logs`. Bridge so the pinned image
   (3436 still has the File transport) runs under GitOps; safe to remove once an
   image built with the stdout-only logger is deployed.

## Verification

- `bun run typecheck` — homelab ✓, discord-plays-pokemon (common/frontend/backend) ✓
- lint — backend `eslint .` ✓, homelab cdk8s `eslint pokemon.ts versions.ts` ✓
- `cd packages/homelab/src/cdk8s && bun run build` — synthesized
  `dist/pokemon.k8s.yaml` shows image `2.0.0-3436` and the `pokemon-logs`
  emptyDir at `/workspace/packages/discord-plays-pokemon/logs`, matching the
  verified-healthy live deployment.
- Live pod `Running 1/1`, bot actively processing voice state updates.

## Session Log — 2026-06-06

### Done

- Diagnosed pokemon CrashLoopBackOff: stale image pin (3412 vs 3436) + winston File transport crashing on non-writable CWD.
- Live-fixed the deployment to `Running 1/1` (image 3436 + writable logs emptyDir).
- Code changes: logger stdout-only, versions.ts → 3436, cdk8s logs emptyDir bridge.
- Verified typecheck, lint, cdk8s synth, and live health.

### Remaining

- Changes are uncommitted in worktree `dreamy-mestorf-141c73` (branch `claude/dreamy-mestorf-141c73`). Commit/push/PR per user preference.
- After this PR's logger fix ships in a future image build, bump `versions.ts` to that build and remove the `pokemon-logs` emptyDir from `pokemon.ts`.
- Consider bringing the pokemon image under Renovate so the pin doesn't go stale again.

### Caveats

- Live deployment currently carries manual kubectl patches; they will be replaced by the chart on the next ArgoCD sync of the published `pokemon` chart built from these code changes.
- The standalone `packages/discord-plays-pokemon/Dockerfile` (WORKDIR `/app`) does NOT match the deployed image's layout (`/workspace/...`); the deployed image is built by the monorepo Dagger pipeline, not that Dockerfile. Not changed here, but worth reconciling.
