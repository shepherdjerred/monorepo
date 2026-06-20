# Discord Plays Pokemon Bugsink check-in + Mario Kart project split

## Status

Complete

## Context

Two asks:

1. Check in on Bugsink issues for **Discord Plays Pokemon**.
2. Mario Kart errors were "going to Pokemon" — create a **new** Bugsink project
   for Mario Kart and reroute it.

Bugsink: `https://bugsink.sjer.red`, team **Jerred**
(`3b66b2ca-ae2c-4828-8494-e421ba3066ca`).

## Root cause of the cross-contamination

Both bots hardcoded the **same DSN** `…@bugsink.sjer.red/8` (project **8 =
Discord Plays Pokemon**):

- `packages/discord-plays-mario-kart/packages/backend/src/index.ts` (`@sentry/bun`,
  `Bun.env.SENTRY_DSN ?? "<hardcoded /8>"`)
- `packages/discord-plays-mario-kart/packages/frontend/src/main.tsx` (`@sentry/react`)

No homelab `SENTRY_DSN` env override exists for the Mario Kart deployment
(grep of `packages/homelab/src` for `SENTRY_DSN` only matches birmel,
starlight-karma-bot, tasknotes, temporal, scout — not mario-kart or pokemon),
so the hardcoded fallback is what production actually uses.

## Pokemon issue check-in (project 8, as of 2026-06-19)

4 unresolved. The `server_name` / `environment` fields split them cleanly:

| Issue                                                           | Events | env / server                 | Verdict                                                                                                            |
| --------------------------------------------------------------- | ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Error [TOKEN_INVALID]: An invalid token was provided.`         | 133    | development / `dagger`       | **CI noise** — Dagger smoke test boots the bot with a placeholder Discord token; fail-fast is captured to Bugsink. |
| `Error: no userbots could log in: An invalid token…`            | 8      | development / `dagger`       | **CI noise** — same root as above (userbot pool can't log in in CI).                                               |
| `Error: Invalid TOML configuration`                             | 63     | **production** / `pokemon-…` | **Real prod bug** (see below).                                                                                     |
| `TypeError: null is not an object (this.connection.readyState)` | 1      | production / `pokemon-…`     | Low priority — single transient (likely discord ws reconnect race).                                                |

Resolved set still shows Mario-Kart-origin issues that leaked into project 8:
`roms/mariokart64.z64 ENOENT` (141 events) and `STICK_CONTROLS is not defined` —
direct evidence of the shared-DSN problem.

### Real prod issue: Invalid TOML configuration (63 events)

Stacktrace at `packages/discord-plays-pokemon/packages/backend/src/config/index.ts:22`.
The provisioned `config.toml` has **all newlines stripped** — the entire file is
on one physical line, so `smol-toml` dies at the first table header
(`server_id = "…"​[bot]…` → "each key-value declaration must be followed by an
end-of-line"). This is a secret-injection / newline-loss problem in how the
config secret is rendered into the pod, not a content typo.

**Security side effect:** because the raw TOML is included in the thrown error's
`cause`, the captured Bugsink event payload contains **live Discord bot +
userbot tokens** in cleartext. Worth rotating those tokens and scrubbing the
config from error payloads. (Not addressed in this session — flagged for owner.)

## What shipped

- Created Bugsink project **"Discord Plays Mario Kart"** (id **13**, slug
  `discord-plays-mario-kart`), settings mirrored from project 8.
  DSN: `https://c2f90a5857e940e1997b49791d9fc684@bugsink.sjer.red/13`.
- Repointed both Mario Kart DSNs from `/8` → `/13`.
- PR **#1263** (branch `feature/mario-kart-bugsink`).

## Session Log — 2026-06-19

### Done

- Checked in on the 4 unresolved Pokemon Bugsink issues; classified 2 as CI/Dagger
  noise and 2 as production (1 real config bug + 1 transient).
- Created new Bugsink project **Discord Plays Mario Kart** (id 13) via REST API.
- Rerouted Mario Kart backend + frontend DSN `/8` → `/13`
  (`packages/discord-plays-mario-kart/packages/{backend/src/index.ts,frontend/src/main.tsx}`).
- Opened PR #1263.

### Remaining

- **Pokemon prod "Invalid TOML" (63 events):** fix the config-secret rendering so
  newlines survive into the pod's `config.toml`. Not started.
- **Token leak:** rotate the Discord bot + userbot tokens exposed in the TOML
  error payload, and stop attaching raw config to the thrown error / scrub PII in
  `Sentry.init`. Not started.
- Optional: suppress the Dagger smoke-test `TOKEN_INVALID` captures (don't init
  Sentry, or set a CI sample/`beforeSend` filter, when `environment=development`/
  `server_name=dagger`) so CI noise stops polluting the Pokemon project.

### Caveats

- New DSN only takes effect once #1263 merges and the Mario Kart image redeploys.
  Existing Mario-Kart-origin issues already in project 8 are not migrated (Bugsink
  has no move-issue API); they'll just stop receiving new events.
- Project 8 retains its history; the two CI-noise `TOKEN_INVALID` issues will keep
  recurring until the smoke-test capture is filtered.
