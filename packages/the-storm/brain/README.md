# The Storm companion pilot

This is a **disabled, manual companion pilot** for one Microsoft Minecraft
account. Two further accounts are reserved and cannot be started by this build.
It validates the 18:00–20:00 `America/Los_Angeles` window, checks Paper's RCON
`list` output for a human player, joins with Mineflayer, and verifies presence
again. `--run` keeps the account connected until the final human leaves, RCON
or Mineflayer disconnects, or the 20:00 deadline arrives. A run can last up
to two hours. It performs no autonomous gameplay or chat.

The repo-owned `pilot.json` defaults to `enabled: false`. The managed
`the-storm-companion-pilot-enabled` flag is also off in production and targets
Alt 1 in beta. The flag can disable a file-enabled pilot at the next run; a
resolved flag value takes precedence over the file. Set `FEATURE_FLAGS_MODE`
explicitly to `flipt` with its `FLIPT_URL`, `FLIPT_NAMESPACE=the-storm-companion`,
and `FLIPT_ENVIRONMENT`, or to `disabled` for local checks without Flipt.
`bun run pilot --check` reads only non-sensitive configuration and never opens
a game or RCON connection. The selected pilot account is `Microsoft Minecraft
Alt 1` in 1Password. Its sign-in identifier is injected through the tracked
`account.env` reference; the file contains no credential value.

Before setting `enabled: true`, set `botPlayerName` in `pilot.json` to the
account's exact public Minecraft profile name. The preflight RCON check
excludes that player, including a pilot left connected by an earlier run.
The post-spawn check rejects a mismatch between the configured and actual
profile names.

Once the other prerequisites are available, the authenticated invocation is:

```bash
cd packages/the-storm/brain
op run --env-file=account.env -- bun run pilot --run
```

`--run` additionally requires explicit enablement and these bootstrap values:

| Name                       | Use                                                               |
| -------------------------- | ----------------------------------------------------------------- |
| `MINECRAFT_BOT_EMAIL`      | Injected from Alt 1's 1Password `username` field                  |
| `MINECRAFT_AUTH_CACHE_DIR` | Absolute private directory for Mineflayer's Microsoft token cache |
| `MINECRAFT_RCON_PASSWORD`  | Injected from the homelab `storm-brain` 1Password item            |

Never put the resolved values or token cache in the repository. The cache directory
must already exist with mode `0700`; the runtime does not create it. Authorize
the pilot account and confirm the credential storage and refresh procedure
before running `--run`. The 1Password password field is never read; Mineflayer
uses Microsoft OAuth and writes its tokens only to the private cache. The
other two accounts stay unconfigured.

The companion RCON configuration is declared in the homelab chart. The
`storm-brain` item must contain a concealed `MINECRAFT_RCON_PASSWORD` field
before release or local `op run`. The server pod fails to start when the
Kubernetes Secret lacks this key. See the
[operator guide](../../docs/wiki/src/content/docs/how-to/prepare-the-storm-companion-rcon.md)
before any live pilot.

Mineflayer 4.39.0 speaks Minecraft 26.1. The production server is Paper 26.2,
so its protocol bridge must be installed and proven before a live pilot. The
repository pins ViaVersion and ViaBackwards for the server, but their pairing
with this Mineflayer build still needs a controlled live acceptance check.

The pilot is a manual session with no recurring start. Temporal-owned
18:00–20:00 scheduling, an authenticated control path, the homelab sidecar
image, bot tab labels, movement, and GPT-6 Luna conversations are separate
deployment steps. No scheduled work is performed in this process.

The shared model catalog now pins GPT-6 Luna to `openai/gpt-6-luna` at the
provider's published text rates. `MonthlyBudget` keeps a SQLite ledger with a
$20 monthly cap and reserves the maximum 2,000 ordinary input, 2,000 cache
read, 2,000 cache write, and 150 output-token turn before a call. An unsettled
reservation remains charged after a crash. This
guard is ready for the later conversation path; the pilot makes no model calls.
Before enabling inference, provision a provider-enforced $20 key limit and
model lock, connect the ledger to every call, and verify cost observability.
