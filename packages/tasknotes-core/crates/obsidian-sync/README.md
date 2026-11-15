# Obsidian Sync boundary

This crate implements account request construction, authentication response
decoding, selective-sync policy, and a sequential WebSocket state machine. It
performs no network, filesystem, clock, or secure-storage I/O. Native hosts own
those resources; the runtime owns replica writes, merge decisions and the outbox.

Protocol and encryption behavior are ported from Obsidian Headless 0.0.14,
commit `0d0ec4364bfde6c715c539cf3555ff8272bb7a58`. The pinned
[official source](https://raw.githubusercontent.com/obsidianmd/obsidian-headless/0d0ec4364bfde6c715c539cf3555ff8272bb7a58/cli.js)
has SHA-256
`c6307dc72c00bcf6f22093fb3e0eb91fdc417fc9dd05884ff2c36e5a19cd0196`.
The upstream client is UNLICENSED; this reference does not grant a license to it.
Native apps never load or execute the upstream JavaScript.

## Account setup

`AuthRequest` builds sign-in, sign-out, account-info, vault-list and vault-access
requests. Sign-in includes the reference's OPTIONS preflight and Origin header.
Decode each response using its matching request instance. MFA responses are
typed challenges rather than generic string errors. Vault discovery retains
owned/shared lists and unfamiliar metadata. Managed vaults supply their password
to the account response; `RemoteVault::derive_key` uses it internally. E2E vaults
require explicit password input. Versions 0, 2 and 3 use the same supported
derivation/encryption functions as the pinned client.

Save the prepared key and account token only in platform secure storage after
vault access succeeds. Never put account bodies, tokens, managed passwords,
key bytes, text frames or downloaded content in logs. Native callers cancel
abandoned account requests. The FFI account wrapper invalidates earlier request
IDs and discovered choices when signing in or signing out.

## Session driver

Create `SessionConfig` from a secure token, remote vault ID and regional host;
then restore `Session` with its cipher and validated `Checkpoint`. Call `begin`,
execute returned effects after releasing the serial engine lock, and deliver
socket/timer inputs through `handle`. Tag callbacks with profile/session/socket
epochs so superseded connections cannot update another active connection.

| Effect                                       | Host action                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Connect`, `SendText`, `SendBinary`, `Close` | Execute native WebSocket work without logging payloads.                                                                                                       |
| `PersistCheckpointDelta`                     | Atomically commit cursor, initial state and the pending-row upsert/removal; then deliver `CheckpointPersisted(revision)`.                                     |
| `RemoteChange`                               | Retain metadata; download selected files, create/remove directories explicitly, and process file tombstones without interpreting folder creation as deletion. |
| `Downloaded`                                 | Verify/apply or park the matching revision durably, then call `complete_remote(uid)`.                                                                         |
| `Uploaded`                                   | Acknowledge the exact immutable outbox receipt. The content hash is not a server UID.                                                                         |
| `Cancelled`                                  | Keep the receipt unacknowledged in the durable outbox and revalidate it before resubmission.                                                                  |
| `Failed`                                     | Surface the typed boundary failure; automatic reconnect is allowed only when `retryable` is true.                                                             |

The shared [JSON schema](../../../tasknotes-fixtures/schema/obsidian-sync.schema.json)
defines checkpoints, deltas, decrypted metadata and filters. Store pending rows
separately, reconstructing the full checkpoint on load; per-notice deltas keep
initial synchronization's persisted bytes linear in the number of files. A
cursor must never commit without the corresponding pending metadata row.

Uploads wait until pending remote changes are durably applied or parked.
Downloads can bypass blocked uploads. A non-echo remote change invalidates
queued snapshots for the affected path; an affected active upload is aborted
before more chunks are sent. The runtime then revalidates the durable receipt
against its current base/local/remote state. The server protocol provides no
conditional-write revision field, so a host must not invent remote CAS.

Uploads preserve immutable encrypted snapshots across reconnects. The host
provides a fresh secure 12-byte nonce for each new content encryption. Empty
files use the reference's zero-byte wire special case. Non-empty files use
2 MiB pieces, each acknowledged individually. Per-file and aggregate queued
upload budgets reject excess work before encryption; rejected receipts remain
in the host outbox. Downloads are sequential and bounded by the configured
per-file limit. Duplicate queued/in-flight download UIDs are coalesced.

All attachment/configuration categories are selected by default. Reference
workspace files, hidden configuration dependencies and excluded folder
boundaries remain excluded. Downloaded plugin files are inert data.

## Verification

Run from `packages/tasknotes-core`:

```sh
cargo test --locked -p obsidian-sync
cargo clippy --locked -p obsidian-sync --all-targets -- -D warnings
```

Ordinary tests use offline crypto vectors and protocol transcripts captured
independently from the pinned official functions. They exercise request/cipher
bytes across all supported versions, MFA, managed/shared discovery, filtering,
piece acknowledgements, limits, cancellation, reconnect, durable notice replay
and a 10,000-file delta stream. They do not authenticate a personal account or
mutate a live vault.

To regenerate the synthetic protocol reference intentionally:

```sh
bun crates/obsidian-sync/tests/capture-reference.mjs
```

The maintenance script verifies the source hash, extracts only selected
reference functions, and uses a fake transport inside a VM. It never executes
CLI startup, contacts account/Sync services, or becomes part of an app build.
Live service convergence with the official client and each platform transport
remains a distinct acceptance layer.
