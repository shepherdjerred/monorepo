# New K8s Services — Secret Audit

## Status

Complete (secrets) — birmel & streambot running; mcp-gateway deferred by user.
Follow-up: streambot yt-dlp writable-dir bug (non-secret, see Remaining).

## Context

User added new services to the cluster (`torvalds`) and asked whether secrets need to be
added. Audited pods in `CreateContainerConfigError` state — the signature of a missing
secret / secret key. Code is already merged and deployed via ArgoCD (no diff vs `main`);
the gap is entirely missing **values in 1Password**, vault `Homelab (Kubernetes)`
(`v64ocnykdqju4ui6j6pua56xw4`).

## Findings

| Service       | Pod state                                           | Root cause                                                                                                                                        | Action needed              |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `streambot`   | `CreateContainerConfigError`                        | 1Password item `streambot-config` **does not exist**                                                                                              | Create item with 7 fields  |
| `mcp-gateway` | `CreateContainerConfigError`                        | Item `mcp-gateway-credentials` has field **labels** `GH_TOKEN`/`FASTMAIL_TOKEN`/`GMAIL_TOKEN` but all are **empty** (operator skips empty fields) | Fill in 3 values           |
| `birmel`      | `CreateContainerConfigError` (pre-existing, broken) | Secret `birmel-birmel-1p` missing key `PINCHTAB_TOKEN`                                                                                            | Add `PINCHTAB_TOKEN` field |

### streambot — `streambot-config` (create new item)

Referenced in `src/cdk8s/src/resources/streambot.ts`. Fields the deployment reads:

- `TOKEN` — Discord bot token
- `GUILD_ID`
- `COMMAND_CHANNEL_ID`
- `VIDEO_CHANNEL_ID`
- `ADMIN_IDS`
- `SERVER_USERNAME` — basic-auth user for streambot's own HTTP server (:3000)
- `SERVER_PASSWORD` — basic-auth password (can be a generated random string)

### mcp-gateway — `mcp-gateway-credentials` (populate empty fields)

Referenced in `src/cdk8s/src/resources/mcp-gateway/index.ts`. Fields exist but are empty:

- `GH_TOKEN` — GitHub PAT (mapped to the GitHub MCP server's token env var)
- `FASTMAIL_TOKEN` — Fastmail JMAP token
- `GMAIL_TOKEN` — Gmail app password (consumed as `USER_PASS`)

`MCP_PROXY_AUTH_TOKEN` (64 chars) and the `canvas` item are fine.

### birmel — `birmel-config` 1Password item (add field)

Deployment references `PINCHTAB_TOKEN` from `birmel-birmel-1p`, but the synced secret has
only `ANTHROPIC_API_KEY`, `DISCORD_CLIENT_ID`, `DISCORD_TOKEN`, `EDITOR_GITHUB_CLIENT_SECRET`,
`OPENAI_API_KEY`, `SENTRY_DSN`. Add a `PINCHTAB_TOKEN` field with a value.

## Progress (via `op` CLI)

- **birmel** ✅ DONE — added `PINCHTAB_TOKEN` to item `w5c27dzybxor3j6dzl7lub2soe`, sourced
  from the existing `PinchTab` item. Synced, pod `1/1 Running`.
- **mcp-gateway** ⏳ partial — set `GH_TOKEN` on item `iixelnobjabehkgxhl3ekacdy4` from the
  existing `GitHub API token` item (synced). Still needs `FASTMAIL_TOKEN` (Fastmail JMAP API
  token) and `GMAIL_TOKEN` (Gmail app password) — not stored anywhere, need from user.
- **streambot** ⏳ partial — created item `streambot-config` (id `rvf3fo4mdspkodfhb4hhrbllce`)
  in `Homelab (Kubernetes)` vault via `op item create`. Sourced `TOKEN`/`SERVER_USERNAME`/
  `SERVER_PASSWORD` from the `Pokebot User` item (Personal vault, per user link), and
  `GUILD_ID`/`COMMAND_CHANNEL_ID`/`VIDEO_CHANNEL_ID` from the pokemon bot's live config
  (same Discord server). **Still missing `ADMIN_IDS`** (user's Discord user ID) — pod can't
  start until that 7th key exists.
  - Connect didn't see the new item on its incremental sync; forced a fresh full sync by
    deleting the connect pod (`onepassword-connect-b855b8d69-5cp22`) so the RS recreated it.
  - Open confirmations for user: (a) `VIDEO_CHANNEL_ID` reuses the pokemon stream voice
    channel — confirm or override; (b) streambot + pokemon userbot would share one Discord
    user token simultaneously (Discord may flag concurrent sessions).
- **mcp-gateway** — deferred at user request (still needs `FASTMAIL_TOKEN`, `GMAIL_TOKEN`).

### Cluster blip (resolved)

Node `torvalds` restarted ~16:06 PDT; flannel CNI came up a bit later and during the gap new
pod sandboxes failed with `/run/flannel/subnet.env: no such file`. Self-healed by ~16:08 once
`kube-flannel` regenerated subnet.env. No action taken — transient reboot recovery.

## Notes

- `scrypted` (new in `home` ns) is **healthy** — no secrets needed.
- All values are user-held credentials; cannot be invented. After populating 1Password,
  the onepassword-connect operator re-syncs the k8s secret within ~1–2 min, then the
  Deployments self-heal (recreate strategy).
- **Newly created 1P items don't appear to Connect immediately** — Connect caches the vault
  and only discovers brand-new items on a full startup sync. Had to delete the connect pod to
  force a fresh sync, then delete the operator pod to clear its exponential-backoff retry timer
  (on reconcile _errors_ the operator ignores POLLING*INTERVAL=60 and backs off for minutes).
  Editing an \_existing* item's fields (birmel, mcp-gateway) synced fine on the normal 60s poll.

## Session Log — 2026-06-06

### Done

- **birmel** fixed: added `PINCHTAB_TOKEN` (from existing `PinchTab` item) → pod `1/1 Running`.
- **mcp-gateway**: set `GH_TOKEN` (from existing `GitHub API token` item); synced. Deferred rest.
- **streambot**: created `streambot-config` 1P item (id `rvf3fo4mdspkodfhb4hhrbllce`) with 6/7
  fields — `TOKEN`/`SERVER_USERNAME`/`SERVER_PASSWORD` from `Pokebot User`, and
  `GUILD_ID`/`COMMAND_CHANNEL_ID`/`VIDEO_CHANNEL_ID` from the pokemon bot's live config.
  Secret synced (6 keys).
- Recovered cluster from a node-reboot CNI blip (no action needed; flannel self-healed).

### Remaining

- ✅ **streambot `ADMIN_IDS`** = `160509172704739328` set; secret synced (7 keys); pod
  `streambot-754f59c8bb-*` **1/1 Running**, logged into Discord as `.pokebot_`.
- ✅ **streambot yt-dlp bug (non-secret)** FIXED in PR #1051: mounted an `emptyDir` at
  `/home/bots/StreamBot/scripts` in `streambot.ts` so the UID-1000 container can write the
  self-downloaded yt-dlp binary (root-owned image WORKDIR otherwise blocked it → `EACCES` →
  `yt-dlp ENOENT` → no URL/YouTube playback). Added `streambot.test.ts` synth smoke test.
  Reaches prod via Dagger → ArgoCD after merge; live pod stays broken until then.
- **Confirm** `VIDEO_CHANNEL_ID` (reused pokemon stream voice channel) is correct.
- **mcp-gateway**: `FASTMAIL_TOKEN` + `GMAIL_TOKEN` (deferred by user).

### Caveats

- streambot reuses the **same Discord user token** as the pokemon userbot; concurrent logins
  with one user token may be flagged/invalidated by Discord.
- `mcp-gateway` `GH_TOKEN` reuses the general homelab GitHub PAT — swap for a scoped token if desired.
- streambot item carries an empty default `password` field from the Password template (harmless).
