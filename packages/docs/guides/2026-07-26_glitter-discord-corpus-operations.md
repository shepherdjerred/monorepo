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
- Discord returns each message page newest-to-oldest for `before`, `after`,
  and daily-overlap cursors. Forward traversal advances from each page's
  largest snowflake; it does not assume the response array is ascending.
- A channel is complete only after its backward traversal reaches an empty
  terminal page, its forward traversal reaches the frozen upper bound with a
  non-empty terminal page, and both contain the same unique message IDs.
- Every immutable write is read back and checksum-verified in SeaweedFS.
- The mutable `latest.json` pointer advances only after SeaweedFS contains the
  exact snapshot checksum.
- The daily job covers at least seven days and must also cross the previous
  snapshot's newest message boundary. A long outage therefore expands work
  instead of silently leaving a gap.
- After six overlap states, the next daily run performs complete backward and
  forward traversals for every visible channel. This bounds recovery lineage
  and re-observes edits or mutable metadata on messages older than seven days.
- Previously captured messages remain in the projection after deletion.
  Messages Discord deleted before their first successful observation cannot be
  recovered and are outside the attainable contract.

## Pre-deployment gate

Create the private `glitter-discord-corpus` SeaweedFS bucket:

```bash
cd packages/homelab/src/tofu/seaweedfs
tofu plan
tofu apply
```

The Temporal deployment reuses the worker's existing SeaweedFS credentials and
projects the existing Starlight bot token from its separate 1Password item.
CDK8s provides the guild identity, bucket, regions, and explicit empty denylist
as non-secret literals:

| Runtime field                          | Source                                          |
| -------------------------------------- | ----------------------------------------------- |
| `GLITTER_DISCORD_TOKEN`                | Starlight 1Password item's `DISCORD_TOKEN`      |
| `GLITTER_DISCORD_GUILD_ID`             | Literal `208425771172102144`                    |
| `GLITTER_DISCORD_GUILD_SLUG`           | Literal `glitter-boys`                          |
| `GLITTER_DISCORD_DENYLIST_CHANNEL_IDS` | Explicit blank literal until inventory approval |
| `GLITTER_CORPUS_S3_ENDPOINT`           | Worker 1Password item's `S3_ENDPOINT`           |
| `GLITTER_CORPUS_S3_BUCKET`             | Literal `glitter-discord-corpus`                |
| `GLITTER_CORPUS_S3_ACCESS_KEY_ID`      | Worker 1Password item's `AWS_ACCESS_KEY_ID`     |
| `GLITTER_CORPUS_S3_SECRET_ACCESS_KEY`  | Worker 1Password item's `AWS_SECRET_ACCESS_KEY` |
| `GLITTER_CORPUS_S3_REGION`             | Literal `us-east-1`                             |

Starlight must have View Channel and Read Message History where archival is
approved. Keep the Message Content privileged intent enabled. Missing secret
fields prevent the pod from starting.
Inventory also reads the current
[application flags](https://docs.discord.com/developers/resources/application#application-object-application-flags)
and fails before pagination when
[Message Content](https://docs.discord.com/developers/events/gateway#message-content-intent)
is not enabled, because Discord otherwise returns empty content-bearing fields.

The daily schedule is created paused even after credentials exist. Leave it
paused until the first complete snapshot passes recovery verification.

## Import the trusted seed

Run the import twice locally before uploading it. The projection checksums must
match:

```bash
cd packages/temporal
first_output=$(mktemp -d /tmp/glitter-seed-first.XXXXXX)
second_output=$(mktemp -d /tmp/glitter-seed-second.XXXXXX)

bun run glitter:import-seed \
  --archive="$HOME/Downloads/glitter-boys.zip" \
  --output="$first_output" \
  --guild-id=208425771172102144 \
  --guild-slug=glitter-boys
bun run glitter:import-seed \
  --archive="$HOME/Downloads/glitter-boys.zip" \
  --output="$second_output" \
  --guild-id=208425771172102144 \
  --guild-slug=glitter-boys

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
| Projection SHA-256 | `ae61f1659196d176b343dc40f19741b0df73be01466f61c2da7561f43a7e08f8` |

After the bucket exists and the worker storage credentials are available,
upload the archive, manifest, projection, and channel partitions:

```bash
bun run glitter:import-seed \
  --archive="$HOME/Downloads/glitter-boys.zip" \
  --output="$first_output" \
  --guild-id=208425771172102144 \
  --guild-slug=glitter-boys \
  --upload=true
```

The approved seed prefix is:

```text
seed/19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92
```

Rerunning the import is safe. Existing immutable objects are accepted only when
their checksums match.

## Inventory and approval

Connect to the production Temporal frontend through its authenticated Tailscale
ingress, then run the inventory workflow:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 \
  TEMPORAL_TLS=true \
  bun run glitter:operate inventory
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
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 \
  TEMPORAL_TLS=true \
  bun run glitter:operate canary \
  --guild-id=<guild-id> \
  --guild-slug=glitter-boys \
  --channel-id=<channel-id> \
  --seed-prefix=seed/19aaca11be85b99d8034e48cfaf45e50e9739e9760da116d7262a6fd7588cc92 \
  --max-pages=1000
```

Do not begin the full backfill unless the canary completes with equal traversal
ID sets, an empty backward terminal page, a non-empty forward terminal page
whose reason is `reached-upper-bound`, and matching storage receipts. A
safety-ceiling failure is not completeness; select a larger ceiling and rerun
deliberately.

## Initial backfill

Start the approved inventory without waiting on the terminal session:

```bash
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 \
  TEMPORAL_TLS=true \
  bun run glitter:operate backfill \
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
- a SeaweedFS missing-object, immutable collision, or checksum failure;
- an inventory-scope alert.

The workflow publishes a canonical pointer only after every approved channel
state is complete.

## Recovery verification and steady state

Run the full rebuild immediately after the initial workflow completes:

```bash
cd packages/temporal
bun run glitter:verify-corpus
```

This command reads every referenced object from SeaweedFS, validates checksums
and snapshot receipts, reconstructs complete channels from raw backward
and forward pages plus the trusted seed, replays at most six daily overlap
states, and requires the rebuilt projection checksums and message count to match
the published snapshot.

After it passes, unpause `glitter-corpus-daily` in Temporal. Run one manual
daily cycle and repeat recovery verification before relying on the schedule:

```bash
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 \
  TEMPORAL_TLS=true \
  bun run glitter:operate daily --wait=true
bun run glitter:verify-corpus
```

The scheduled run is at 04:15 America/Los_Angeles with overlap policy `SKIP`.
The Temporal dashboard and Prometheus rules expose progress, rate limiting,
authorization failure, storage integrity failure, inventory drift, and snapshot
age.

## Shared-context refresh acceptance

Leave `glitter-context-refresh-weekly` paused until the first complete snapshot
passes recovery verification. Capture the verified immutable snapshot identity:

```bash
cd packages/temporal
bun run glitter:verify-corpus
```

Then run two fixed-time dry runs with the exact `snapshotId` and
`snapshotSha256` returned by that command:

```bash
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 \
  TEMPORAL_TLS=true \
  bun run glitter:operate context-refresh \
  --dry-run=true \
  --now=<fixed-iso-timestamp> \
  --snapshot-id=<verified-snapshot-uuid> \
  --snapshot-sha256=<verified-snapshot-sha256> \
  --wait=true
```

Verify:

- the result names the exact pinned snapshot ID and checksum;
- both runs return the same `proposalSha256`, `changedFiles`, and generated
  result;
- only eligible people are refreshed (20 new messages or 90 days);
- every style sample is an exact safe corpus candidate;
- relationship changes cite available message IDs and preserve superseded
  events as `historical`;
- `changedFiles` contains only shared-package data and generated-data paths;
- a second rehearsal is byte-idempotent.

The first execution for an exact model request creates a private, immutable
generation artifact under the guild's SeaweedFS prefix. The key is derived
from the complete safe request plus every value used to finalize the generated
card. Responses are schema-validated before creation, conditional creation
makes concurrent first writers converge on one winner, and every reuse verifies
the stored response checksum. A dry run can create these derived artifacts, but
it does not create a Git branch, commit, or pull request. Repeated dry runs,
activity retries, and the subsequent real run reuse the same artifacts. The
snapshot pin bypasses `snapshots/latest.json`, so daily corpus publication
cannot change the acceptance input between those runs.

Run once with `--dry-run=false`, the same `--now`, both snapshot pin flags, and
`--wait=true` only after those checks pass. It may open one human-reviewed pull
request and never auto-merges. Activity retries reuse a branch derived from the
Temporal workflow run ID, so they update or reuse the same exact-head proposal
rather than opening duplicates. A `no-diff` result opens no pull request. After
reviewing that first PR, unpause the Monday 11:00 America/Los_Angeles schedule.

## Incident response

Never repair `latest.json` by hand.

1. Pause `glitter-corpus-daily`.
2. Preserve the failed workflow and immutable object keys.
3. Correct credentials, permissions, or rate pressure before attempting
   recovery.
4. Restore a missing or corrupt immutable object only from an independently
   verified SeaweedFS backup. Seed-prefix objects may instead be recreated from
   the pinned trusted archive and must reproduce the documented checksums. If a
   Discord REST evidence object has no verified backup, preserve the incident
   and start a new inventory/backfill rather than overwriting its key.
5. Run `bun run glitter:verify-corpus`.
6. Retry the failed workflow or start a new inventory/backfill when its
   immutable request ID collided with changed Discord data.
7. Unpause only after the verifier succeeds.

An immutable collision means the same evidence key produced different bytes.
Treat it as a correctness event, not as an object to overwrite.

## Session Log — 2026-07-27

### Done

- Corrected the seed commands to require guild
  `208425771172102144`/`glitter-boys` and pinned the normalized projection
  checksum.
- Corrected the canary terminal proof and documented fixed-time weekly
  rehearsals through the supported operator command.

### Remaining

- Complete credential projection, deployment, seed upload, inventory approval,
  canary, backfill, recovery verification, and schedule acceptance.

### Caveats

- Both ZIP roots are channel-export groups in one guild; archive directory
  names are retained as provenance and are not guild identities.

## Session Log — 2026-07-28

### Done

- Updated the operating contract, deployment prerequisites, import command,
  verifier, monitoring, and incident response for sole-canonical SeaweedFS
  storage.
- Replaced the nonfunctional Kubernetes port-forward instructions with the
  healthy Tailscale Temporal endpoint and added explicit `TEMPORAL_TLS=true`
  support to the operator CLI.
- Uploaded the trusted seed twice from the production worker and verified 101
  immutable objects totaling 167,246,402 bytes under the approved prefix.
- Recorded production inventory SHA-256
  `8f115f88e68f6ae735d38907357e0fc96e35709927c2e8c0d4f15024d833af23`
  with 267 included entries and 30 explicit exclusions.
- Updated the canary ceiling for the known `league-of-legends` channel after
  live traversal proved it exceeds 100 pages, and corrected forward-page
  ordering and verification cursors to match Discord's newest-to-oldest
  response contract.

### Remaining

- Deploy the canary fixes, complete canary/backfill/recovery and daily/weekly
  live acceptance, then unpause the accepted schedules.

### Caveats

- SeaweedFS currently has neither replication nor Velero volume backup. The
  trusted seed is reproducible from its pinned archive, but later Discord REST
  evidence requires an independent backup to survive total SeaweedFS loss.
- The failed canary runs wrote immutable request/response evidence but did not
  publish `latest.json`; failed-closed evidence remains safe to retain.
