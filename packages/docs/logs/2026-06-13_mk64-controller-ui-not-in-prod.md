# MK64 skeuomorphic controller UI not visible in prod — diagnosis

## Status

Complete (diagnosis only; fix not yet applied)

## Question

User: "I made a change for mariokart 64 today to change the design but I don't see it in prod."
The change = the **skeuomorphic N64 controller UI** (`feat(discord-plays-mario-kart): skeuomorphic N64 controller UI`, commit `6242668ab`, merged ~11:14 PDT 2026-06-13). User confirmed the **leaderboard** (a later change) _is_ visible in prod at https://mariokart.sjer.red/.

## Root cause

Prod is pinned to image **`2.0.0-3921`**, which was built from a **PR branch that never contained the controller redesign**. Newer images that _do_ contain it already exist in ghcr but the version pin was never bumped.

`packages/homelab/src/cdk8s/src/versions.ts:145` →
`"shepherdjerred/discord-plays-mario-kart": "2.0.0-3921@sha256:eb2893f4…"`

### Evidence — each image's source commit (via `crane config` → `org.opencontainers.image.revision`)

| Image                                            | Source commit | Controller UI? |
| ------------------------------------------------ | ------------- | -------------- |
| **2.0.0-3921** (PINNED / live in prod)           | `a3c670b48`   | **MISSING**    |
| 2.0.0-3954                                       | `3a4835e01`   | HAS            |
| 2.0.0-3960                                       | `98d64329c`   | HAS            |
| **2.0.0-3993** (latest, = main HEAD `593bec9ec`) | `593bec9ec`   | **HAS**        |

`git merge-base --is-ancestor 6242668ab a3c670b48` → **NO** (3921's source predates/excludes the redesign).
`git merge-base --is-ancestor 6242668ab 74752d7e9` (leaderboards) → **NO** — the leaderboards PR #1143 branch was cut before / never rebased onto the controller-UI merge, so its image (3921) shipped the leaderboard but regressed the old plain-button controller.

### Empirical confirmation against live prod

- Live pod `mario-kart-56555fb476-84k6d` (ns `mario-kart`), `1/1 Running`, image `2.0.0-3921`.
- `kubectl port-forward` → fetched served bundle `/assets/index-BEk_L9tp.js`: **0 matches** for every distinctive class from `controller-ui.tsx` (`tracking-[0.08em]`, `inset_0_2px…`, `…rounded-sm bg-zinc-900`).
- User screenshot shows the **old** plain buttons (`◄ steer / accel (A) / steer ► / brake (B) / hop (R) / item (Z) / start`) + the Leaderboard card.
- Build mechanism is sound (no stale-dist trap): `.dagger/src/image.ts` runs `bun run build` in `packages/frontend` from source; dist is **not** committed. So any image built from a source tree containing `6242668ab` serves the redesign.

## Compounding deploy issues (why prod is fragile right now)

Prod is only up via a **manual `kubectl patch`** from an earlier session (bc798a57), not git. ArgoCD app `mario-kart` = **OutOfSync** but autoSync is empty (`{}`), so the patch persists. Git desired-state still has:

1. `replicas: 0` (`packages/homelab/src/cdk8s/src/resources/mario-kart.ts:38`) — fix in **open/unmerged PR #1169**.
2. Baked entrypoint `bunx prisma db push --skip-generate` — Prisma 7 removed `--skip-generate` → crashloop; fix in **open/unmerged PR #1171** (also hardens the smoke test that missed it). 3993 (main HEAD) still has this, since #1171 isn't merged.

So a clean ArgoCD sync of the _current_ git state would revert to 0 replicas / crashloop.

## Fix path (not yet executed — needs user go-ahead, mutates prod)

1. Merge **#1171** (drop `--skip-generate` + smoke-test hardening) → triggers a fresh image built from main (has controller UI + leaderboard + working entrypoint).
2. Merge **#1169** (replicas 0→1).
3. Bump `versions.ts` pin `2.0.0-3921` → the new image (or `2.0.0-3993` if entrypoint is overridden by cdk8s rather than baked — verify which).
4. Let ArgoCD sync; drop the manual patch. Confirm served bundle now contains the redesign markers.

## Session Log — 2026-06-13

### Done

- Traced "design change not in prod" to image-pin regression: prod runs `2.0.0-3921` (source `a3c670b48`, no controller UI); main + images `3954/3960/3993` have it.
- Proved it empirically: `crane config` revision labels + git ancestry + live `port-forward` bundle grep (0 markers) + user screenshot.
- Confirmed build recompiles frontend from source (no stale-dist cause) and identified the two compounding deploy blockers (replicas:0, `--skip-generate` crashloop) held by unmerged PRs #1169/#1171, with prod surviving on a manual patch.

### Remaining

- Execute the fix path above (merge #1171 + #1169, bump version pin, sync) — awaiting user go-ahead since it merges PRs and changes prod.

### Caveats

- Re-pinning to `3993` alone won't fix the crashloop unless the `--skip-generate` entrypoint is fixed (#1171) OR the cdk8s deployment overrides `command` (the live patch sets a `command` — verify whether that override lives in git or only in the manual patch).
- ArgoCD has no autoSync, so nothing reverts the manual patch automatically — but also nothing auto-deploys the fix; it'll need a manual/Argo sync after the version bump.
