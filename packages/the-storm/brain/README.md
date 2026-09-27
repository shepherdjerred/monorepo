# The Storm companion pilot

This is a **disabled, one-shot connectivity pilot** for one Microsoft Minecraft
account. Two further accounts are reserved and cannot be started by this build.
It validates the 18:00–20:00 `America/Los_Angeles` window, checks Paper's RCON
`list` output for a human player, joins with Mineflayer, verifies presence
again, and disconnects. It performs no autonomous gameplay or chat.

The repo-owned `pilot.json` defaults to `enabled: false`. The managed
`the-storm-companion-pilot-enabled` flag is also off in production and targets
Alt 1 in beta. The flag can disable a file-enabled pilot at the next run; a
resolved flag value takes precedence over the file. Set `FEATURE_FLAGS_MODE`
explicitly to `flipt` with its `FLIPT_URL`, `FLIPT_NAMESPACE=the-storm-companion`,
and `FLIPT_ENVIRONMENT`, or to `disabled` for local checks without Flipt.
`bun run pilot --check` reads only non-sensitive configuration and never opens
a game or RCON connection. `--run` additionally requires explicit enablement
and these bootstrap values from the existing authenticated credential wrapper:

| Name                        | Use                                                               |
| --------------------------- | ----------------------------------------------------------------- |
| `MINECRAFT_BOT_EMAIL`       | Microsoft account identifier for the pilot only                   |
| `MINECRAFT_BOT_PLAYER_NAME` | In-game name to exclude from human presence                       |
| `MINECRAFT_AUTH_CACHE_DIR`  | Absolute private directory for Mineflayer's Microsoft token cache |
| `MINECRAFT_RCON_PASSWORD`   | RCON authentication for the local server                          |

Never put these values or the token cache in the repository. The cache directory
must already exist with mode `0700`; the runtime does not create it. Authorize
the pilot account and confirm the credential storage and refresh procedure
before running `--run`. The other two accounts stay unconfigured.

Mineflayer 4.39.0 speaks Minecraft 26.1. The production server is Paper 26.2,
so its protocol bridge must be installed and proven before a live pilot. The
repository pins ViaVersion and ViaBackwards for the server, but their pairing
with this Mineflayer build still needs a controlled live acceptance check.

The pilot is a manual, one-shot command. A continuously present companion,
Temporal-owned 18:00–20:00 scheduling, an authenticated control path, the
homelab sidecar image, bot tab labels, movement, and GPT-6 Luna conversations
are separate deployment steps. No scheduled work is performed in this process.

The shared model catalog now pins GPT-6 Luna to `openai/gpt-6-luna` at the
provider's published text rates. `MonthlyBudget` keeps a SQLite ledger with a
$20 monthly cap and reserves the maximum 2,000-input/150-output-token turn
before a call. An unsettled reservation remains charged after a crash. This
guard is ready for the later conversation path; the pilot makes no model calls.
Before enabling inference, provision a provider-enforced $20 key limit and
model lock, connect the ledger to every call, and verify cost observability.
