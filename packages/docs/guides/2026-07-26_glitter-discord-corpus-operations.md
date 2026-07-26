---
id: guide-2026-07-26-glitter-discord-corpus-operations
type: guide
status: complete
board: false
---

# Glitter Discord Corpus Operations

This runbook initializes, verifies, and operates the loss-intolerant Glitter
Discord corpus. The canonical contract is every message available through the
archival bot in every approved public channel, public thread, and forum thread.
Private threads and direct messages are excluded.

The implementation follows Discord's official
[message pagination](https://docs.discord.com/developers/resources/message),
[thread enumeration](https://docs.discord.com/developers/topics/threads), and
[rate-limit](https://docs.discord.com/developers/topics/rate-limits)
contracts.

## Safety invariants

- The trusted seed is accepted only at exactly 76,762 unique message IDs.
- The initial inventory is immutable and manually approved by checksum before
  the full backfill starts.
- Discord requests are sequential and globally limited to one request per
  second. Stricter reset headers and `retry_after` values extend that delay.
- Initial capture is one channel at a time. Each channel runs in a child
  workflow so a large guild cannot exhaust one Temporal history.
- A channel is complete only after backward and forward traversals reach empty
  terminal pages and contain the same unique message IDs.
- Every immutable write is read back and checksum-verified in both SeaweedFS
  and Cloudflare R2.
- The mutable `latest.json` pointer advances only after both stores contain the
  exact snapshot checksum.
- The daily job covers at least seven days and must also cross the previous
  snapshot's newest message boundary. A long outage therefore expands work
  instead of silently leaving a gap.
- Previously captured messages remain in the projection after deletion.
  Messages Discord deleted before their first successful observation cannot be
  recovered and are outside the attainable contract.

## Pre-deployment gate

Create the private `glitter-discord-corpus` bucket in both OpenTofu stacks:

```bash
cd packages/homelab/src/tofu/seaweedfs
tofu plan
tofu apply

cd ../cloudflare
tofu plan
tofu apply
```

Create an R2 Object Read & Write token restricted to that bucket. Before the
Temporal deployment rolls, add all of these fields to the existing Temporal
worker 1Password item:

| Field                                  | Value                                                |
| -------------------------------------- | ---------------------------------------------------- |
| `GLITTER_DISCORD_TOKEN`                | Dedicated archival bot token                         |
| `GLITTER_DISCORD_GUILD_ID`             | Glitter Boys guild snowflake                         |
| `GLITTER_DISCORD_GUILD_SLUG`           | `glitter-boys`                                       |
| `GLITTER_DISCORD_DENYLIST_CHANNEL_IDS` | Comma-separated channel IDs or a present blank field |
| `GLITTER_CORPUS_S3_ENDPOINT`           | SeaweedFS S3 endpoint                                |
| `GLITTER_CORPUS_S3_BUCKET`             | Private SeaweedFS corpus bucket                      |
| `GLITTER_CORPUS_S3_ACCESS_KEY_ID`      | Bucket-scoped SeaweedFS access key                   |
| `GLITTER_CORPUS_S3_SECRET_ACCESS_KEY`  | Bucket-scoped SeaweedFS secret key                   |
| `GLITTER_CORPUS_S3_REGION`             | Optional; defaults to `us-east-1`                    |
| `GLITTER_CORPUS_R2_ENDPOINT`           | Account-specific R2 S3 endpoint                      |
| `GLITTER_CORPUS_R2_BUCKET`             | Private Cloudflare R2 corpus bucket                  |
| `GLITTER_CORPUS_R2_ACCESS_KEY_ID`      | Bucket-scoped R2 access key                          |
| `GLITTER_CORPUS_R2_SECRET_ACCESS_KEY`  | Bucket-scoped R2 secret key                          |
| `GLITTER_CORPUS_R2_REGION`             | Optional; defaults to `auto`                         |

The bot must have only View Channel and Read Message History where archival is
approved. Enable the Message Content privileged intent. Missing secret fields
prevent the pod from starting, so provision them before deployment.
Inventory also reads the current
[application flags](https://docs.discord.com/developers/resources/application#application-object-application-flags)
and fails before pagination when
[Message Content](https://docs.discord.com/developers/events/gateway#message-content-intent)
is not enabled, because Discord otherwise returns empty content-bearing fields.

The daily schedule is created paused even after credentials exist. Leave it
paused until the first complete snapshot passes recovery verification.

## Import the trusted seed

Run the import twice locally before mirroring it. The projection checksums must
match:

```bash
cd packages/temporal
first_output=$(mktemp -d /tmp/glitter-seed-first.XXXXXX)
second_output=$(mktemp -d /tmp/glitter-seed-second.XXXXXX)

bun run glitter:import-seed \
  --archive="$HOME/Downloads/glitter-boys.zip" \
  --output="$first_output"
bun run glitter:import-seed \
  --archive="$HOME/Downloads/glitter-boys.zip" \
  --output="$second_output"

sha256sum "$first_output/projection.ndjson" \
  "$second_output/projection.ndjson"
cmp "$first_output/projection.ndjson" \
  "$second_output/projection.ndjson"
```

Expected trusted-seed acceptance:

| Property           | Expected                                                           |
| ------------------ | ------------------------------------------------------------------ |
| Archive SHA-256    | `19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92` |
| CSV files          | 164                                                                |
| Observations       | 76,762                                                             |
| Unique messages    | 76,762                                                             |
| Duplicate IDs      | 0                                                                  |
| First timestamp    | `2016-08-03T07:15:58.632Z`                                         |
| Last timestamp     | `2025-11-23T03:01:23.939Z`                                         |
| Projection SHA-256 | `8bad3bee568dfb5eb60d6524eee6b3c75d6ea3b1ac8f545887bac60cc8db572f` |

After both buckets exist and the worker storage credentials are available,
mirror the archive, manifest, projection, and channel partitions:

```bash
bun run glitter:import-seed \
  --archive="$HOME/Downloads/glitter-boys.zip" \
  --output="$first_output" \
  --mirror=true
```

The approved seed prefix is:

```text
seed/19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92
```

Rerunning the import is safe. Existing immutable objects are accepted only when
their checksums match.

## Inventory and approval

Port-forward the production Temporal frontend, then run the inventory workflow:

```bash
kubectl -n temporal port-forward svc/temporal-server 7233:7233

cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run glitter:operate inventory
```

Review every included and excluded entry. Specifically verify:

- every expected public text/announcement channel appears;
- active and archived public/forum threads are present;
- private threads are excluded;
- denylisted parents and their threads are excluded;
- no expected channel reports `exclude-no-history-permission`.

Record the emitted `inventoryKey` and `inventorySha256`. Never approve an
inventory by guild name alone.

## Pagination canary

Before the full scrape, choose one reviewed public channel with more than 100
messages but a bounded history. The canary performs the exact backward/forward
proof and writes immutable evidence, but it does not publish `latest.json`:

```bash
TEMPORAL_ADDRESS=localhost:7233 bun run glitter:operate canary \
  --guild-id=<guild-id> \
  --guild-slug=glitter-boys \
  --channel-id=<channel-id> \
  --seed-prefix=seed/19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92 \
  --max-pages=100
```

Do not begin the full backfill unless the canary completes with equal traversal
sets, empty terminal pages, and matching mirror receipts. A safety-ceiling
failure is not completeness; select a larger ceiling and rerun deliberately.

## Initial backfill

Start the approved inventory without waiting on the terminal session:

```bash
TEMPORAL_ADDRESS=localhost:7233 bun run glitter:operate backfill \
  --inventory-key=<approved-inventory-key> \
  --inventory-sha=<approved-inventory-sha256> \
  --seed-prefix=seed/19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92
```

Watch the workflow and child workflows in Temporal. Pause or terminate only
through Temporal; immutable completed pages remain safe to retry. Stop and
investigate any of these signals:

- Discord 401/403;
- repeated 429 responses despite the conservative ceiling;
- a backward/forward set mismatch;
- a page cursor, ordering, identity, or checksum mismatch;
- a SeaweedFS/R2 missing-object or checksum divergence;
- an inventory-scope alert.

The workflow publishes a canonical pointer only after every approved channel
state is complete.

## Recovery verification and steady state

Run the full rebuild immediately after the initial workflow completes:

```bash
cd packages/temporal
bun run glitter:verify-corpus
```

This command reads every referenced object from both stores, validates mirror
parity and snapshot receipts, reconstructs complete channels from raw backward
and forward pages plus the trusted seed, recursively replays daily overlap
states, and requires the rebuilt projection checksums and message count to
match the published snapshot.

After it passes, unpause `glitter-corpus-daily` in Temporal. Run one manual
daily cycle and repeat recovery verification before relying on the schedule:

```bash
TEMPORAL_ADDRESS=localhost:7233 bun run glitter:operate daily --wait=true
bun run glitter:verify-corpus
```

The scheduled run is at 04:15 America/Los_Angeles with overlap policy `SKIP`.
The Temporal dashboard and Prometheus rules expose progress, rate limiting,
authorization failure, mirror divergence, inventory drift, and snapshot age.

## Incident response

Never repair `latest.json` by hand.

1. Pause `glitter-corpus-daily`.
2. Preserve the failed workflow and immutable object keys.
3. Correct credentials, permissions, rate pressure, or the damaged mirror.
4. Copy the checksum-verified object from the healthy store to the exact key in
   the damaged store.
5. Run `bun run glitter:verify-corpus`.
6. Retry the failed workflow or start a new inventory/backfill when its
   immutable request ID collided with changed Discord data.
7. Unpause only after the verifier succeeds.

An immutable collision means the same evidence key produced different bytes.
Treat it as a correctness event, not as an object to overwrite.
