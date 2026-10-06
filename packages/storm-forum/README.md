# Storm forum runtime

The Storm's XenForo integration owns repeatable forum configuration, its portal,
independently authored child styles, Minecraft status, and coordinated backups.
Reviewed public historical discussions retain original names and dates, with new replies enabled.

## Licensed inputs and image boundary

The public runtime image contains PHP, Bun, the Storm add-on, community-owned
artwork, and the authored Flexile adaptation source. It contains no XenForo
distribution, generated native style exports, or commercial add-on code.
`config/forum.json` is the dependency and topology contract. A release bundle
contains a fresh licensed XenForo `upload/` tree, add-on distributions extracted
into their native paths, and the two vendor style archives under `vendor/`.

The parent styles are Flexile adaptations for XenForo 2, authored in
`themes/flexile/`. The builder combines those tracked customizations with the
installed, licensed XenForo master template. Its generated archives contain
licensed XenForo code and remain private: `vendor/flexile-storm-light.zip` and
`vendor/flexile-storm-dark.zip`. Each archive is pinned by SHA-256, adaptation
version, appearance, native export format, and exact XenForo base version.
Both archives pass preflight before installation or either parent import.
Keep the Audentio attribution in the footer when changing the adaptation.

The shared `@shepherdjerred/storm-theme` catalog owns Classic, four seasons, eight
festivals, scenery, holiday logos, decorations, and Pacific calendar windows.
The 42 selectable styles offer System, light, and dark appearances, each with
13 explicit themes and a stable Follow calendar choice. System uses native
XenForo variations; followers inherit effective seasonal values.
The native chooser saves appearance and theme through XenForo's existing member
preferences or guest cookies. Import preserves the original six IDs, members'
selections, and the active default. Legacy parents and unrelated styles are retained.

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

`storm:history` imports the reviewed `config/history.json` corpus with native
profile-only identities keyed by original member ID, original post names and
dates, recovered avatars, formatting, and native attachments. Profiles have
empty email addresses, native NoPassword authentication, and no restored staff
privileges or account-claim flow. Transactional checkpoints preserve IDs, edits,
and new replies. A reviewed corpus revision requires `storm:history --migrate`;
edited messages are retained and reported. Revisions cannot omit mapped posts or
discussions; use native moderation to hide or correct existing content. Reviewed
thread title, forum, and slug changes are applied before checkpointing. Imported
identity metadata (including avatar bytes) and attachment membership/metadata
are checkpointed; unsupported revisions reject before writes, including dry runs.
`scripts/enrich-history.ts` reads an
explicit archive directory without modifying it; optional `--public-archives`
recovery copies verified public images into this package.

The theme API shares native preferences and a credentialed, no-store viewer
summary with player docs. Account, alerts, conversations, login, and logout use
native forum routes; the response excludes email and message content. Public social cards
use the effective calendar theme, check guest visibility, and cache by content
and renderer/artwork revision. Personal appearance choices do not change cards.

## Configuration and bootstrap

Product behavior uses typed configuration and the managed `storm` feature flag
namespace. Registration defaults closed. The season flag accepts `auto` or a
catalog ID; the calendar flag defaults off and targets beta by stage. Automatic
selection uses long festival windows and seasonal gaps in America/Los_Angeles.
The existing minute-by-minute Temporal housekeeping activity reparents followers
only when the effective theme changes. A named operator override also controls
followers; members' explicit themes remain intact. Existing live manual flag
values are preserved until deliberately changed. The
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

To build the private style archives from tracked source, add
`--export-styles .local/storm-flexile/exports` to the integration command. This
prints both checksums and copies the exports before checking the manifest pins.
After changing the theme, review the generated checksums, update both style pins
in `config/forum.json`, and rerun the harness. The builder requires a disposable
localhost installation. Its native template anchors fail explicitly if a
XenForo upgrade changes the underlying layout. Keep generated exports and the
licensed input distributions out of Git; `.local/` is excluded from Git and the
Docker context. The theme source and builder are version-controlled.

The integration harness uses random credentials and isolated, disposable Docker
containers. It exercises actual XenForo entities, repeated configuration, private
support, new-account restrictions, and promotion criteria. Theme builds also
exercise all 42 managed styles, parent migration, inherited palettes, repeated
imports, preserved member choices, follower transitions and rejection of missing
styles or altered/incompatible archives.
The optional preview
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
