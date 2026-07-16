# Home Assistant `cffi`/`_cffi_backend` version mismatch breaks reolink & roborock

## Status

Complete

## Context

User spotted two persistent-notification errors in Home Assistant:

1. "Eufy Security - Error: Connection to Eufy Security add-on is broken, retrying in background!"
2. "Invalid config: The following integrations and platforms could not be set up: reolink, roborock"

## Investigation

- `home-eufy-security-ws` pod (namespace `home`) is healthy — connected to the Eufy
  station, no crash loop. The failure is entirely on the HA side.
- HA logs (`kubectl logs -n home home-homeassistant-...`) show the `eufy_security`
  custom component (`fuatakgun/eufy_security` v8.2.4, pinned in
  `packages/homelab/src/cdk8s/src/versions.ts`) crashing its websocket read loop:
  `TypeError: the JSON object must be str, bytes or bytearray, not ServerTimeoutError`
  in `eufy_security_api/web_socket_client.py:69` — it calls `.json()` on a message
  whose `.data` is actually the timeout exception, not payload bytes. v8.2.4 is the
  latest upstream release (2026-04-09) — no fix available yet. HA's automatic
  reconnect recovers it, so this is cosmetic/self-healing, not addressed further.
- `reolink` and `roborock` both fail to import with:

  ```
  Exception: Version mismatch: this is the 'cffi' package version 2.1.0, ...
  When we import the top-level '_cffi_backend' extension module, we get version 2.0.0, ...
  ```

  This breaks `pycryptodome`/`pycryptodomex` (`Crypto.Cipher.AES` / `Cryptodome.Cipher.AES`),
  which both integrations depend on. Root cause: the pure-Python `cffi` package and the
  compiled `_cffi_backend` native extension baked into
  `ghcr.io/home-assistant/home-assistant:2026.7.1` are out of sync — an upstream base-image
  bug, not anything in our cdk8s config.

- Verified via `crane ls` that `ghcr.io/home-assistant/home-assistant:2026.7.2` exists,
  and confirmed by `docker run --platform linux/amd64` against that image that
  `cffi` and `_cffi_backend` both report `2.0.0`, and both `reolink_aio` and
  `roborock` import cleanly.

## Fix

Bumped `packages/homelab/src/cdk8s/src/versions.ts`:
`home-assistant/home-assistant` `2026.7.1@sha256:f73512b...` → `2026.7.2@sha256:1476924357b46e80735c13e94232ba5c853cac052e9df4bb28d50fa56348097b`.

## Session Log — 2026-07-11

### Done

- Diagnosed both HA notification errors via `kubectl logs` against the live
  `home-homeassistant` and `home-eufy-security-ws` pods.
- Verified `2026.7.2` fixes the cffi mismatch by pulling the image and checking
  `cffi`/`_cffi_backend` versions plus a live `reolink_aio`/`roborock` import test.
- Bumped the HA image pin in `packages/homelab/src/cdk8s/src/versions.ts` (worktree
  `.claude/worktrees/ha-cffi-fix`, branch `fix/ha-cffi-mismatch`).
- `bun run test` (homelab) — 419 pass, 0 fail across both `src/cdk8s` and
  `src/helm-types`. `bun run typecheck` — clean.
- Opened PR (see PR link in chat).

### Remaining

- ArgoCD will roll the new HA image out once the PR merges to `main` — no manual
  `kubectl` action needed (GitOps).
- The `eufy_security` custom component's `ServerTimeoutError` crash is unresolved
  upstream (latest release, no fix available). Not actionable right now; it
  self-recovers via HA's reconnect logic. Worth rechecking `fuatakgun/eufy_security`
  releases occasionally for a fix.

### Caveats

- The `eufy_security` websocket crash is unrelated to the cffi mismatch — two
  separate bugs that happened to surface in the same HA notification screenshot.
- Did not verify the fix against live prod HA (would require the PR to merge and
  ArgoCD to sync); verification was done by pulling and inspecting the target image
  directly, plus the existing cdk8s test suite passing against the new pin.
