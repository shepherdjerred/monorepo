---
title: Sync agent history across machines
description: Turn on the encrypted Brim sync archive on each Mac and the Windows PC so Claude Code and Codex sessions from every machine can be searched and counted on the Macs.
sidebar:
  order: 44
---

This guide connects a machine to the Brim sync archive. Every machine pushes
its transcripts, and each Mac also pulls the others for `toolkit history` and
Brim's usage caption. [About Brim](/explanation/quotabar/#cross-machine-sync)
explains the design.

## Before the first machine

These exist once and are shared by every machine.

| Piece                  | Where                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `brim-sessions` bucket | [SeaweedFS buckets](packages/homelab-cdktn/src/stacks/seaweedfs.ts), applied by CI          |
| Scoped `brim-sync` key | `brim-sync` identity in `seaweedfs-s3-credentials`; keys in the `brim-sync-seaweedfs` item  |
| age identity (secret)  | `brim-sync-age-identity` item in the homelab vault                                          |
| age recipient (public) | `brimSyncRecipient` default in [toolkit config](packages/toolkit/src/lib/toolkit-config.ts) |

Confirm the bucket and key before connecting a machine. The listing should
succeed and may be empty.

```bash
aws --profile brim-sync s3 ls s3://brim-sessions/
```

## Connect a Mac

1. Render the `brim-sync` AWS profile from the dotfiles source. On an agent
   host, render only `~/.aws/config` (see below).

   ```bash
   chezmoi diff ~/.aws/config ~/.aws/credentials
   chezmoi apply ~/.aws/config ~/.aws/credentials
   ```

2. Install the binaries.

   ```bash
   cd packages/toolkit && bun run install:local
   ```

3. Run the first push in the foreground. It backfills the whole history, which
   can take a while; later runs upload only new lines.

   ```bash
   brim sync push
   ```

4. Install the LaunchAgent. It runs `brim sync run` (push, then pull) every
   five minutes.

   ```bash
   brim sync install
   ```

5. Check the result. `Archive` should list your files and `LaunchAgent` should
   be loaded.

   ```bash
   brim sync status
   ```

Set `brim.sync.machine.id` in `~/.toolkit/config.toml` first if two machines
share a hostname. The id names the machine's prefix in the bucket for good.

An agent-host Mac keeps no rendered secrets, so its dotfiles skip
`~/.aws/credentials`. Skip the credentials target in step 1 and have `brim`
resolve the scoped key through the 1Password service account instead:

```toml
[brim.sync.s3]
credentials = "broker"
```

## Connect the Windows PC

The PC only pushes. It holds the public recipient and the scoped key, never the
age identity.

1. Build `brim.exe` from the checkout and render the credentials. The steps are
   in the [Windows dotfiles README](packages/dotfiles-windows/README.md#brim-sync).
2. Applying the source registers the `BrimSyncPush` Scheduled Task, which runs
   `brim.exe sync push` at logon and every five minutes.
3. Start it once and read the log.

   ```powershell
   Start-ScheduledTask BrimSyncPush
   Get-Content ~/.toolkit/brim-sync/logs/task.log
   ```

## Confirm it end to end

On a Mac, after the other machines have pushed:

```bash
brim sync pull
toolkit history search --source codex-mirror "<a phrase from a PC session>"
```

`brim sync status` lists each mirrored machine with its pull time. Brim shows
an `All machines` line under Claude Code and Codex once another machine has
usage today.

## Purge a leaked credential

Push already overwrites credentials before upload, but transcripts archived
earlier, the local files, and the history index keep them until purged. Purge
every copy in this order, or a pull restores what you removed.

1. Stop the scheduled runs on every Mac, so none races the purge.

   ```bash
   launchctl bootout gui/$(id -u)/com.jerred.brim-sync
   ```

2. On each machine, preview and then overwrite the matches in its own
   transcripts. The second command also retires the affected archive
   generations.

   ```bash
   brim sync redact --dry-run
   brim sync redact
   ```

3. Push from the same machine. It re-uploads the redacted files and deletes the
   old segments from the bucket.

   ```bash
   brim sync push
   ```

4. On every Mac, pull, then rebuild the history index, which also stores tool
   output.

   ```bash
   brim sync pull
   toolkit history daemon reindex
   ```

5. Reinstall the agents with `brim sync install`.

The off-site Backblaze copy keeps replaced objects for 30 days. Those copies
were age-encrypted and expire on their own. A credential that reached a model
provider in a session is still only made harmless by rotating it.

## When something fails

| Symptom                                                 | Fix                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `InvalidAccessKeyId` or `AccessDenied`                  | Re-render `~/.aws/credentials`; check the gateway identity still grants `brim-sessions` |
| `already has an archive but … manifest.json is missing` | Run one push with `BRIM_SYNC_AGE_IDENTITY` available so it adopts the remote manifest   |
| `another sync is running`                               | A backfill is still running; the next scheduled run continues                           |
| `a single line exceeds 64 MiB`                          | That file is skipped and reported each run; every other file still syncs                |
| Brim shows `Other machines' usage could not be read.`   | `~/.toolkit/brim-sync/mirror/index.json` is invalid; run `brim sync pull` to rewrite it |

## Related

- [About Brim](/explanation/quotabar/) — why sync is push-only and encrypted
- [Enable Mac usage metrics](/how-to/enable-mac-usage-metrics/) — the per-machine
  OTLP push, which does not count mirrored sessions
