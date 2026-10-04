# Storm forum runtime

The Storm's XenForo integration owns repeatable forum configuration, its portal,
independently authored child styles, Minecraft status, and coordinated backups.
The forum starts with fresh discussions and clearly attributed editorial history.

## Licensed inputs and image boundary

The public runtime image contains PHP, Bun, the Storm add-on, and community-owned
artwork. It contains no XenForo distribution or commercial theme/add-on code.
`config/forum.json` is the dependency and topology contract. A release bundle
contains a fresh licensed XenForo `upload/` tree, add-on distributions extracted
into their native paths, and the two vendor style archives under `vendor/`.

Private bundles live in the protected `storm-forum-releases` bucket. Each release
references an immutable object key and SHA-256. Init downloads and verifies the
bundle into an ephemeral application volume. It does not install or migrate the
database. Never put licensed archives in the repository, image context, CI cache,
public artifacts, or PR attachments. Licensed inputs must comply with each vendor's
production and password-protected test installation terms.

## Entrypoints

| Command                   | Behavior                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun src/cli.ts assemble` | Verify and unpack the private bundle; combine the system and Postal certificate authorities.                                                                                                                              |
| `bun src/cli.ts release`  | Take an exclusive release lock, close requests, install the fresh database or preserve an installed database, install pinned dependencies, configure, import styles, publish managed editorial threads, and rebuild jobs. |
| `bun src/cli.ts worker`   | Poll the stage's Temporal activity queue for housekeeping and coordinated snapshots.                                                                                                                                      |
| `bun src/cli.ts restore`  | Verify a committed backup pair and restore into an empty, private beta database and empty attachment directories.                                                                                                         |

Release jobs are explicit and versioned. A failed migration leaves its release
lock and maintenance marker for inspection; restarting a pod never retries a
migration. The lock records the owning execution. Remove only that exact lock
and marker after diagnosing the failure and verifying the database state.
Release code rejects an incomplete installation rather than overwriting tables.
An upgrade to a different XenForo version requires an explicit migration change.

Managed nodes, groups, permissions, navigation, widgets, styles, and initial
editorial threads retain stable IDs. Configuration never deletes unrelated
content. Existing editorial text remains editable by staff and is preserved on
releases. Private support is readable by its author and staff. The portal and
recent-thread widget query only public forums.

## Configuration and bootstrap

Product behavior uses typed configuration and the managed `storm` feature flag
namespace. Registration defaults closed. The season flag chooses the default
light seasonal style; members' explicit style choices remain intact. The
manifest owns native XenForo settings and the direct Minecraft service address.
The status activity reads only the exact Minecraft StatefulSet and pings its
backend, preserving server hibernation. Public caches contain counts, never
player names.

The dedicated stage-specific 1Password item supplies these required fields:

| Fields                                            | Consumer                                            |
| ------------------------------------------------- | --------------------------------------------------- |
| `DB_PASSWORD`, `MARIADB_ROOT_PASSWORD`            | Forum and database bootstrap                        |
| `BUNDLE_ACCESS_KEY`, `BUNDLE_SECRET_KEY`          | Private bundle reader, scoped to the release bucket |
| `BACKUP_ACCESS_KEY`, `BACKUP_SECRET_KEY`          | Snapshot writer, scoped to the backup bucket        |
| `RESTORE_ACCESS_KEY`, `RESTORE_SECRET_KEY`        | Beta restore Job only, read-only snapshot access    |
| `POSTAL_SMTP_USERNAME`, `POSTAL_SMTP_PASSWORD`    | Postal STARTTLS authentication                      |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`      | Required registration challenge                     |
| `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Fresh-install administrator, release job only       |
| `STAGING_HTTP_AUTH`                               | Beta ingress password file                          |

Database, bundle, backup, and Temporal connection locations are bootstrap inputs
declared by the homelab chart. Credentials are references in configuration and
injected into native mail/CAPTCHA options in memory, never stored in `xf_option`.

## Storage and recovery contract

The database and writable files have separate NVMe claims. A snapshot closes PHP
requests, waits for the maximum request lifetime, exports MariaDB, and archives
`data/` and `internal_data/`. Payloads have checksums and sizes. Uploading the
manifest last commits the pair. The protected bucket participates in the existing
SeaweedFS-to-R2 backup policy. Only a tested pair establishes restore confidence.

Recovery requires `STORM_FORUM_STAGE=beta`, the backup reader credentials,
`RESTORE_MANIFEST_KEY`, and the exact `BUNDLE_SHA256` recorded in the snapshot.
The restore command rejects occupied databases, occupied attachment directories,
mixed releases, invalid archive paths, links, and checksum mismatches. Before
clearing maintenance it reapplies the beta URL, closes registration, selects the
normal season, and rebuilds jobs. Failed recovery leaves maintenance enabled.

Declare a beta release with `storageSlot: "recovery"` and
`restore: { "manifestKey": "snapshots/prod/<snapshot-uuid>/manifest.json" }` in
the release inventory. Its wave-zero Job restores instead of installing a new
forum, using dedicated read-only credentials. Beta declares both primary and
recovery PVC pairs so changing the selected pair cannot prune the original data.
Subsequent releases retain `storageSlot: "recovery"` and omit `restore`.
The recovery pair must be empty; repeated drills require reviewed storage
replacement through the homelab's existing destructive-operation workflow.
Production releases cannot select the recovery pair or request restore.

## Development

Run the root workspace setup, then `bun run build`, `typecheck`, `test`, and `lint`
from this package. Build the public runtime with:

```sh
docker build --target image -t storm-forum:dev -f packages/storm-forum/Dockerfile .
docker build --target smoke -f packages/storm-forum/Dockerfile .
bun packages/storm-forum/scripts/local-integration.ts /absolute/private/xenforo/upload --preview
```

The integration harness uses random credentials and isolated, disposable Docker
containers. It exercises actual XenForo entities, repeated configuration, private
support, new-account restrictions, and promotion criteria. The optional preview
binds only localhost. Ctrl-C removes its exact containers and network.
`scripts/local-backup-test.ts` takes that harness's explicit application container
name and exercises a real database/files round trip through an isolated S3 API
fixture. This proves the payload and restore implementation; SeaweedFS/R2 and
Postal delivery still require deployment acceptance.

Homelab charts and ArgoCD applications consume the validated release inventory at
`packages/homelab/src/cdk8s/src/resources/storm-forum/releases.json`. Entries require
published image digests, private bundle checksums, and provisioned 1Password item
IDs. An empty inventory publishes inactive charts and creates no forum application.
Temporal schedules begin paused and are enabled only after stage acceptance.
