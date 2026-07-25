---
id: plan-2026-07-11-ha-custom-components-pinned
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Generalize HA custom-component installs to the pinned-tarball model; patch-file eufy_security and Mysa (no forks)

## Context

Home Assistant currently has two parallel, undocumented ways of getting custom_components onto its
config PVC:

1. **Git-managed** (`packages/homelab/src/cdk8s/src/resources/home/homeassistant.ts:67-128`): a single
   `install-eufy-security` init container downloads a pinned `fuatakgun/eufy_security` release tarball,
   verifies its sha256 against `EUFY_TARBALL_SHA256` in `versions.ts`, and extracts it — reproducible,
   reviewed in PRs, survives a PVC rebuild from git alone.
2. **HACS, mutable PVC state**: 7 more integrations (`adaptive_lighting`, `dreo`, `emporia_vue`, `kumo`,
   `mysa`, `petlibro`, `sonoff`) plus one frontend plugin (`custom-brand-icons`) were installed by
   clicking through the HACS UI. None of this is visible to git — confirmed live via
   `kubectl exec -n home <pod> -- ls /config/custom_components/` and
   `/config/.storage/hacs.repositories`. This was never a deliberate architecture decision; `eufy_security`
   just happened to get the git-managed treatment in one prior session with no documented rationale for
   diverging from HACS.

This inconsistency surfaced while debugging two unrelated HA notification errors (cffi mismatch fixed in
PR #1453; a separate `eufy_security` websocket crash-on-timeout bug that never self-clears its
persistent-notification banner). Investigating the eufy fix path exposed that HACS is the odd one out,
not `eufy_security`. Rather than leaving that inconsistency in place, we're generalizing the proven
pinned-tarball pattern to **all** installed components, closing the loop so nothing on this PVC installs
or updates outside of git ever again.

Two components need special handling beyond "just pin the version" — both handled the same way, no forks:

- **`eufy_security`**: has a real, reproducible bug (crashes on aiohttp keepalive timeout; the resulting
  persistent notification never auto-dismisses). Fix: stay pinned to upstream `fuatakgun/eufy_security`
  @ `v8.2.4` exactly as today, but add two checked-in `.patch` files applied at install time — mirroring
  the `wasm-src/patches/*.patch` + `REDLIB_SOURCE_REF`-style pattern already used in
  `.dagger/src/constants.ts` for `redlib`/`pokeemerald-wasm`. No fork, no new repo.
- **`mysa`**: already privately forked (`shepherdjerred/Mysa_HA`, 3 commits ahead of true upstream
  `kgelinas/Mysa_HA` — a setpoint-limits fix). Fold those 3 commits into a checked-in `.patch` file
  applied at install time, pin to the real upstream repo/tag directly, and **delete the
  `shepherdjerred/Mysa_HA` fork** once the patch is extracted and verified to apply cleanly — it's fully
  superseded by the patch file, nothing should keep pointing at it.

## Overview — all 9 components

| Slug                 | Repo (pinned source)                       | Install shape                                                                | Notes                                                                                    |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `adaptive_lighting`  | `basnijholt/adaptive-lighting` @ `v1.31.0` | `custom_components`                                                          | direct pin                                                                               |
| `dreo`               | `JeffSteinbok/hass-dreo` @ `v1.10.1`       | `custom_components`                                                          | direct pin                                                                               |
| `emporia_vue`        | `magico13/ha-emporia-vue` @ `v0.12.2`      | `custom_components`                                                          | direct pin                                                                               |
| `kumo`               | `dlarrick/hass-kumo` @ `v0.4.6`            | `custom_components`                                                          | direct pin                                                                               |
| `mysa`               | `kgelinas/Mysa_HA` @ `v0.9.2`              | `custom_components`                                                          | **+ checked-in patch** (setpoint limits fix, currently only on `shepherdjerred/Mysa_HA`) |
| `petlibro`           | `jjjonesjr33/petlibro` @ `v1.2.32`         | `custom_components`                                                          | direct pin                                                                               |
| `sonoff`             | `AlexxIT/SonoffLAN` @ `v3.12.2`            | `custom_components`                                                          | direct pin                                                                               |
| `eufy_security`      | `fuatakgun/eufy_security` @ `v8.2.4`       | `custom_components`                                                          | **+ 2 checked-in patches** (websocket crash fix, notification auto-dismiss)              |
| `custom-brand-icons` | `elax46/custom-brand-icons` @ `2026.07.0`  | `www_community` (specific `dist/*.js` files, not a `custom_components/` dir) | direct pin                                                                               |

`hacs` itself is **not** in this manifest — it gets removed by the new prune step and nothing installs
through it again.

## Implementation

### 1. `eufy_security` patches (no fork)

- Stay pinned to `fuatakgun/eufy_security` @ `v8.2.4` in `versions.ts`, exactly as today.
- Write two checked-in patch files under `packages/homelab/src/cdk8s/patches/eufy_security/`:
  - `0001-check-message-type-before-json.patch` — `eufy_security_api/web_socket_client.py`, `_on_message`:
    check `message.type == aiohttp.WSMsgType.TEXT` before calling `.json()`, instead of unconditionally
    parsing every frame (fixes the `TypeError: ... not ServerTimeoutError` crash on keepalive timeout).
  - `0002-dismiss-notification-on-reconnect.patch` — `eufy_security_api/api_client.py`, `_on_open()`: call
    `persistent_notification.dismiss(hass, "eufy_security_addon_connection_error")` so the "Connection to
    Eufy Security add-on is broken" banner clears itself once the websocket reconnects, instead of sitting
    there forever.
- Generate each patch by diffing a pristine `v8.2.4` extraction against a locally-edited copy
  (`diff -u` or `git diff` in a throwaway clone), verify with `patch -p1 --dry-run` before committing.
- `EUFY_SECURITY_TARBALL_SHA256` stays what it already is for the upstream `v8.2.4` tarball (verifies the
  _pristine_ download before patches are applied — patches apply after the hash check, same ordering as
  Mysa below).

### 2. Mysa patch file (+ delete the fork once extracted)

- Regenerate the patch from the real tag, not `main`: `git diff v0.9.2...shepherdjerred:Mysa_HA:main --
custom_components/mysa/climate.py custom_components/mysa/number.py` (exclude the
  `manifest.json` version-only bump and the test file — versioning is handled by `versions.ts`, not the
  file itself). Verified diff exists and applies cleanly (checked via GitHub compare API: 3 commits ahead,
  0 behind, touching exactly `climate.py`, `manifest.json`, `number.py`, `tests/test_climate.py`).
- Save as `packages/homelab/src/cdk8s/patches/mysa/0001-expose-device-setpoint-limits.patch`
  (numbered-prefix convention matching `wasm-src/patches/0001-extra-exports.patch`).
- Verify with `patch -p1 --dry-run` against a pristine `v0.9.2` extraction before committing it.
- `versions.ts` pins `"kgelinas/Mysa_HA": "v0.9.2"` (true upstream), not the personal fork.
- **Delete `shepherdjerred/Mysa_HA` from GitHub** once the patch file is committed and verified to apply
  cleanly — confirmed destructive action, do this only after the patch is proven good, not before.

### 3. New file: `packages/homelab/src/cdk8s/src/resources/home/ha-custom-components.ts`

Single-purpose extracted helper (matches existing precedent: `misc/zfs-nvme-volume.ts`,
`misc/tailscale.ts`, `misc/cloudflare-tunnel.ts`). Lives in `resources/home/` since it's HA-specific, not
a general cdk8s abstraction. Exports:

- `HaCustomComponentSpec` type — discriminated `install` union: `{ kind: "custom_components", slug,
patches?: string[] }` vs `{ kind: "www_community", slug, files: string[] }`. `patches` is a list of
  relative paths under `patches/<slug>/` read at synth time (`readFileSync`) and embedded as a heredoc in
  the generated shell script, applied via `patch -p1` after extraction and before `cp -r` into place — no
  new ConfigMap/volume plumbing needed, consistent with how the whole install script is already inlined
  into `args`. `eufy_security` (2 patches) and `mysa` (1 patch) use this field; the other 7 don't.
- `HA_CUSTOM_COMPONENTS: HaCustomComponentSpec[]` — the 9-entry manifest above.
- `createHaCustomComponentInitContainer(spec)` — generalizes the current hand-written eufy shell script
  (download → `sha256sum -c` verify → extract → optional `patch -p1` → copy → write `.installed_version`
  marker to skip re-download) parameterized by `repo`/`version`/`sha256`/`install`. Branches on
  `install.kind` for the copy step: whole `custom_components/<slug>` dir vs specific `files[]` into
  `www/community/<slug>/`. Resources hardcoded inside the helper (100m/128Mi request, 500m/512Mi limit —
  same as today's eufy container; the `require-container-resources` ESLint rule can't see through a
  spread-of-function-call, which is fine since every container needs identical resources here, no
  per-call-site override required).
- `buildPruneScript(specs)` / a final `prune-stale-ha-components` init container — enumerates
  `/config/custom_components/*` and `/config/www/community/*`, deletes anything not in the declared slug
  set (including `hacs` itself and its `.storage/hacs.{critical,data,hacs,repositories}` state files).
  Must run **after** all 9 installs (K8s init containers run strictly sequentially in array order, so this
  is just "append last") — this ordering is what makes the first-deploy transition safe: each install
  container's own `rm -rf "$TARGET_DIR"; cp -r ...` overwrites the old HACS-installed content with the
  pinned copy _before_ prune ever runs, so nothing gets deleted-then-never-replaced.

### 4. `homeassistant.ts` changes

Remove the hand-written `install-eufy-security` block (lines 67-128). Replace with:

```ts
for (const spec of HA_CUSTOM_COMPONENTS) {
  deployment.addInitContainer({
    ...createHaCustomComponentInitContainer(spec),
    volumeMounts: [{ path: "/config", volume }],
  });
}
deployment.addInitContainer(
  buildPruneInitContainer(HA_CUSTOM_COMPONENTS, volume),
);
```

### 5. `versions.ts` changes

- Keep `"fuatakgun/eufy_security": "v8.2.4"` and `EUFY_TARBALL_SHA256` exactly as they are today (still
  pinning the pristine upstream tarball; the two patches apply on top at install time, not via a version
  change).
- Add 8 new `// renovate: datasource=github-releases versioning=semver` entries (the 7 direct-pin
  integrations + `kgelinas/Mysa_HA`) and 8 new `<NAME>_TARBALL_SHA256` constants, each with the same JSDoc
  pattern the eufy one already uses (purpose, CI enforcement pointer, regen command). No `renovate.json`
  changes needed — its customManager regex already matches any `// renovate: datasource=...` line in
  `versions.ts` generically.
- All 8 new sha256 values get computed for real (`curl -fSL <tarball-url> | sha256sum`) immediately —
  all are public upstream repos, no blockers.

### 6. Generalized CI integrity test

Replace `packages/homelab/src/cdk8s/src/eufy-tarball-integrity.test.ts` with
`packages/homelab/src/cdk8s/src/ha-custom-component-integrity.test.ts` — a `for` loop over
`HA_CUSTOM_COMPONENTS` generating one `it()` per component that (a) verifies the pristine tarball's
sha256 (same check as today, now for all 9) and (b) for `eufy_security`/`mysa`, also asserts each
declared `patches` file exists on disk and applies cleanly (`patch -p1 --dry-run`) against the freshly
verified, pristine extraction — so a version bump that invalidates a patch's context fails CI loudly
instead of crash-looping the pod. Same CI-gating env vars, 120s timeout each, per-component pass/fail
attribution in the test name.

### 7. `configuration.yaml` — `custom-brand-icons` frontend resource

HACS's plugin install also wrote a Lovelace resource registration into `.storage/lovelace_resources`
(separate from the file placement this migration handles). Leave that file untouched (avoids any live
disruption), but also add a declarative entry so the dependency on that mutable `.storage` file is fully
removed going forward:

```yaml
frontend:
  extra_module_url:
    - /local/community/custom-brand-icons/custom-brand-icons.js
```

Verify `default_config:` (already present) doesn't conflict with an explicit top-level `frontend:` key on
HA `2026.7.2` before merging (their interaction has changed across HA versions — confirm rather than
assume, e.g. via a local config check).

## Verification

1. `bun run test` / `bun run typecheck` in `packages/homelab` (existing suite + new integrity test, which
   stays network-skipped locally same as today's eufy test).
2. `HA_CUSTOM_COMPONENT_TARBALL_TEST=1 bun test src/ha-custom-component-integrity.test.ts` once all 8 new
   hashes are filled in, to confirm every pinned hash matches its real tarball and both eufy/mysa patches
   apply cleanly before opening the PR.
3. `bun run build` in `src/cdk8s` to confirm the Deployment renders with 10 init containers in the right
   order (9 installs + prune last).
4. Deploy via PR → ArgoCD sync (never `kubectl apply` directly). Immediately after rollout:
   - `kubectl exec -n home <pod> -- ls /config/custom_components/` — expect exactly the 8
     `custom_components`-kind slugs, **no** `hacs`, no stale leftovers.
   - `kubectl exec -n home <pod> -- ls /config/www/community/` — expect exactly `custom-brand-icons`.
   - Confirm `adaptive_lighting`'s existing ConfigEntry survives the pod restart with no re-auth/re-setup
     prompt (validates the "HA matches by `manifest.json` domain, not install mechanism" assumption on at
     least one real, already-configured integration).
   - Confirm `custom-brand-icons` still renders in the frontend (icon pack loads).
   - `kubectl logs -n home <pod> -c install-eufy-security` to confirm the patched tarball
     downloaded/verified/extracted/patched cleanly.
5. Over the following days: watch for the "Eufy Security add-on is broken" notification — if it fires
   again, confirm it now auto-dismisses within ~10s of the reconnect (instead of sitting there
   indefinitely), validating the `_on_open` patch actually works in production (can't be simulated
   on-demand; this is an observational check, not a synchronous test).

## Manual/confirm-before-executing steps (not automated by this plan)

- Deleting `shepherdjerred/Mysa_HA` from GitHub (destructive, irreversible — confirmed with the user; do
  only after the extracted Mysa patch is committed and verified to apply cleanly).
- Any `kubectl exec`/live-pod verification commands are read-only and fine to run without separate
  confirmation.

## Session Log — 2026-07-11

### Done

- Generated both `eufy_security` patches by editing a pristine `v8.2.4` extraction and diffing against
  it, verified `patch -p1 --dry-run` + real-apply byte-for-byte against the intended result:
  `packages/homelab/src/cdk8s/patches/eufy_security/0001-check-message-type-before-json.patch` (guards
  `_on_message` against non-TEXT websocket frames) and `0002-dismiss-notification-on-reconnect.patch`
  (threads an `on_open_callback` through `ApiClient` so the coordinator can dismiss the stale banner on
  reconnect). Found and fixed a real bug in my own first pass: upstream's `web_socket_client.py` uses
  CRLF line endings; my first patch attempt mixed CRLF (context) with LF (new lines) — fixed by
  re-encoding my inserted lines to CRLF before diffing, verified the result is fully CRLF-consistent.
- Generated the Mysa patch (`packages/homelab/src/cdk8s/patches/mysa/0001-expose-device-setpoint-limits.patch`)
  from `git diff v0.9.2...shepherdjerred:Mysa_HA:main` (climate.py + number.py only, excluding the
  version-only manifest.json bump and test file), verified it applies cleanly and matches the fork exactly.
- New `packages/homelab/src/cdk8s/src/resources/home/ha-custom-components.ts`: `HaCustomComponentSpec`
  manifest type (discriminated `custom_components`/`www_community` install union with optional
  `patches`), the 9-entry `HA_CUSTOM_COMPONENTS` array, `createHaCustomComponentInitContainer` (patch
  content read at synth time via `Bun.file(...).text()`, embedded as a `patch -p1` heredoc), and
  `createPruneStaleComponentsInitContainer`.
- `homeassistant.ts`: replaced the hand-written `install-eufy-security` init container with a loop over
  `HA_CUSTOM_COMPONENTS` + the prune container appended last (10 init containers total, verified correct
  order in `dist/home.k8s.yaml`).
- `versions.ts`: added 8 new `github-releases`-pinned entries + matching `_TARBALL_SHA256` constants
  (all computed live via `curl | sha256sum` against real tags); `fuatakgun/eufy_security` and
  `EUFY_TARBALL_SHA256` unchanged (still upstream-direct, patches apply on top).
- New `packages/homelab/src/cdk8s/src/ha-custom-component-integrity.test.ts` replacing
  `eufy-tarball-integrity.test.ts` — table-driven over all 9 components, plus (for eufy_security/mysa)
  a real `tar` extract + `patch -p1 --dry-run` against the freshly-verified pristine tarball. Ran with
  `HA_CUSTOM_COMPONENT_TARBALL_TEST=1`: **9/9 pass**.
- `configuration.yaml`: added `frontend: extra_module_url:` for `custom-brand-icons`. Discovered live
  (via `.storage/lovelace_resources` on the pod) that HACS had registered the icon pack at
  `/hacsfiles/custom-brand-icons/...` — a URL alias only HACS's own integration serves — so this isn't
  defense-in-depth as originally planned, it's required: that alias disappears once HACS is gone. Pointed
  the declarative entry at HA's native `/local/community/...` alias instead.
- Full verification: `bun run build`, `bun test` (163 pass / 0 fail), `bunx tsc --noEmit` (clean),
  `bunx eslint --fix` (clean after fixing `interface`→`type`, `unicorn/prefer-string-raw`,
  `unicorn/import-style`), `bunx prettier --check` (clean), `bun run test` at the package level (251
  pass / 0 fail across cdk8s + helm-types).
- Opened PR (link in chat).

### Remaining

- **Deploy verification** (can't be done pre-merge): after this PR merges and ArgoCD syncs, confirm on
  the live pod: exactly 8 `custom_components/` dirs + no `hacs`; exactly `custom-brand-icons` under
  `www/community/`; `adaptive_lighting`'s existing ConfigEntry survives the restart with no re-auth
  prompt; the icon pack still renders in the frontend; watch for the next "Eufy Security add-on is
  broken" notification and confirm it now auto-dismisses within ~10s of reconnect (the `_on_open` patch
  can't be tested synchronously — it only fires on a real keepalive-timeout reconnect).
- ~~Delete `shepherdjerred/Mysa_HA`~~ — done. `gh repo delete` was denied by the harness's permission
  system when I attempted it (destructive actions need a fresh in-tool-call grant, not just prior
  conversational confirmation); the user ran it themselves. Verified via `gh repo view
shepherdjerred/Mysa_HA` → repository no longer resolves.

### Caveats

- The CRLF/LF mixed-line-ending bug in my first eufy patch attempt was caught before it ever left this
  session (via `patch -p1 --dry-run` + byte-for-byte `diff` verification before writing any patch file
  into the repo) — but it's a reminder that `diff -u` against a real-world third-party file needs an
  explicit line-ending check, not just a successful dry-run apply.
- The `ha-custom-component-integrity.test.ts` patch-verification step shells out to `tar`/`patch` — both
  need to be present on whatever CI image runs this (Buildkite agents already have them for other tests
  in this package; not verified against the local `bun test` environment specifically beyond this
  session's own successful run).
- Did not verify the `frontend: extra_module_url:` + `default_config:` interaction against a real running
  HA instance (only inferred from HA docs); flagged in the plan as worth confirming post-deploy if the
  icon pack doesn't render.

## Remaining

- [ ] Complete and verify the work described in `Generalize HA custom-component installs to the pinned-tarball model; patch-file eufy_security and Mysa (no forks)`.
