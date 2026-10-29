# Storm forum runtime

The Storm's XenForo integration owns repeatable forum configuration, its portal,
independently authored child styles, and Minecraft status.
Reviewed public historical discussions retain original names and dates, with new replies enabled.

## Licensed inputs and image boundary

The runtime image contains PHP, Bun, the Storm add-on, community-owned
artwork, and the authored Flexile adaptation source. It contains no XenForo
distribution, generated native style exports, or vendor add-on code.
`config/forum.json` owns product content and topology. The language-neutral
`packages/ops-model/src/forum-bundle-policy.json` owns XenForo and licensed
style versions/checksums; PHP and TypeScript validate that same policy. A private release
bundle contains a fresh licensed XenForo `upload/` tree and the two Flexile style
archives under `vendor/`; no third-party add-ons are required for launch.

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

`prepare-production.ts --publish-only` writes `delivery-bundle.json` beside the
private archive. Register that descriptor with
`toolkit deploy forum publish --file <private-output>/delivery-bundle.json --machine`.
Publication stays pending until the API independently reads the exact private
bytes, verifies the outer digest and every ZIP entry, and matches the XF/version
and style checksums to the producer's immutable repository policy. Licensed
acquisition has no invented CI pipeline; later genuine CI publications retain
the original qualified artifact identity.

Before the first upgrade, `toolkit deploy forum baseline --file <descriptor> --machine`
requests a read-only original baseline with environment ID, expected generation,
qualified original image/bundle artifact IDs, request ID and reason. Inspect it
with `toolkit deploy forum inspect <intent-id>`. Independent inspection reads the
actual completed release Job, ready Pod digests and installed database version
twice. It records original provenance without accepting a deployment. The first
upgrade freezes that baseline and checks it again before candidate source
selection. Later upgrades use the actually accepted release.

The fixed `/_delivery/status` endpoint listens only on the internal observer port
8082 and requires a dedicated read-only bearer capability. Public and admin
listeners deny that path. Missing observer credentials, unknown original source
policy, unsettled maintenance or missing native provenance block adoption.
Ordinary image rollback is refused. Velero's scheduled backups of the forum
volumes are the only backup.

## Entrypoints

| Command                   | Behavior                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun src/cli.ts assemble` | Verify and unpack the private bundle; combine the system and Postal certificate authorities.                                                                                                          |
| `bun src/cli.ts release`  | Take an exclusive release lock, close requests, install pinned dependencies, configure, import styles/history, retire generated launch content, apply the authorized account merge, and rebuild jobs. |
| `bun src/cli.ts worker`   | Poll the stage's Temporal activity queue for housekeeping.                                                                                                                                            |

Release jobs are explicit and versioned. A failed migration leaves its release
lock and maintenance marker for inspection; restarting a pod never retries a
migration. Keep the owning lock and maintenance marker until same-owner recovery
independently verifies completion.
Release code rejects an incomplete installation rather than overwriting tables.
An upgrade to a different XenForo version requires an explicit migration change.

For an interrupted `install`, `addons`, `seed`, `history` or `accounts` step,
the operator recovery command reports the exact journal hash. It does not retry
that step. Keep dispatch paused and the original executor stopped. Inspect the
original Job, PVC and candidate before repairing native state.
An operator can copy its terminal Pod with existing Kubernetes tooling:

```bash
kubectl --context admin@torvalds -n FORUM_NAMESPACE debug ORIGINAL_POD --copy-to=MANUAL_REPAIR_POD --container=release --keep-init-containers=true --keep-labels=true --profile=restricted --share-processes=false -- php NATIVE_COMMAND
```

Use only the original image and mounted data. For reviewed content repair the
native command arguments are `/opt/storm-forum/runtime/command.php storm:seed`,
`/opt/storm-forum/runtime/command.php storm:history --migrate`, and
`/opt/storm-forum/runtime/command.php storm:accounts --stage STAGE`; inspect their native checkpoints and
pending merge first. For installation or add-on failures, diagnose the native
installer/add-on state before using XenForo's installation or add-on recovery
tools. An incomplete installation is never overwritten by `runtime/install.php`.
Do not delete a pending merge marker to make a command pass.

Wait for the exact manual Pod to terminate, retain its result, and remove that
Pod with its recorded UID before rerunning recovery. The existing foreground
recovery command accepts `--action repair --acknowledge-step STEP
--expected-journal-sha256 HASH`. Its fixed `runtime/recovery-step-verify.php`
must prove that one step complete using native installation, add-on, content or
account checkpoints. Only then does it append that checkpoint and continue;
it never reruns the acknowledged step. Failed inspection leaves the original
owner, journal and maintenance intact.

Managed nodes, groups, permissions, navigation, widgets, and styles retain stable
IDs. `storm:seed` soft-deletes only the three mapped, unreplied generated launch
threads and records their permanent retirement. It never recreates them or deletes
unrelated content. Private support is readable by its author and staff. The portal and
recent-thread widget query only public forums.

The managed classic reactions use XenForo's native reaction entities and picker:
Like, Agree, Disagree, Funny, Winner, Informative, Useful, Optimistic, Friendly,
and Creative. Like keeps native ID 1; additional types retain registry-backed IDs.
Disagree is neutral. Stock extras are disabled without deleting existing votes;
independently customized reactions remain untouched. Captured aggregate ratings
remain in the recovery corpus; they are neither displayed nor imported as votes
because the voters are not recoverable. Posts display only native reactions.
The public `/admin.php` uses XenForo authentication and required administrator
TFA; installer, source, internal data and CLI paths remain blocked by nginx.

`storm:history` imports the reviewed `config/history.json` corpus with native
profile-only identities keyed by forum era and original member ID, original post names and
dates, recovered avatars, formatting, and native attachments. Profiles have
empty email addresses, native NoPassword authentication, and no restored staff
privileges. Transactional checkpoints preserve IDs, edits,
and new replies. A reviewed corpus revision requires `storm:history --migrate`;
edited messages are retained and reported. Revisions cannot omit mapped posts or
discussions; use native moderation to hide or correct existing content. Reviewed
thread title, forum, and slug changes are applied before checkpointing. Imported
identity metadata (including avatar bytes) and attachment membership/metadata
are checkpointed; unsupported revisions reject before writes, including dry runs.
`scripts/enrich-history.ts` reads an
explicit archive directory without modifying it; optional `--public-archives`
recovery copies verified public images into this package.
`scripts/expand-history.ts <archive directory>` adds captured short announcements
and image-only public replies while preserving existing identity/media checkpoints
and reviewed reconstructed endings. It restores the captured Chaos, Towns/town
subforums and Community Voting destinations. Deployment's explicit migration adds
new replies without replacing native post IDs, edits or later replies. Missing
image bytes retain original source links; recovered public imagery is served locally.
`scripts/recover-captures.ts <archive directory> <repo-local recovery directory>`
adds corroborated 2016/2022 captures and historical ratings/poll summaries. Original
registry keys remain unchanged; revival keys use an era prefix. Only the explicitly
identified owner shares a profile across eras. Rating totals stay in the recovery
corpus; captured closed poll results retain their sources. The importer does not
create voters or change reputation. The
release applies its reviewed corpus with `--migrate`, including earlier first posts
while retaining previous native posts and later replies.

For already imported profiles, run
`bun packages/storm-forum/scripts/restore-avatars.ts` from the repository root
to validate `config/avatar-recovery.json` against **production**, namespace
`storm-forum`, deployment `storm-forum-web`. Existing authenticated `kubectl`
access is required. Review the dry-run identities before adding `--apply`.
The command checks pinned image hashes and original-to-native identity mappings,
holds the history lock, rejects pending account merges, and uses XenForo's avatar
service only for profiles without custom avatars or Gravatars. It preserves
import checkpoints and never runs during deployment. Provenance distinguishes
archived bytes from explicitly approved current Minecraft heads; archived
player UUIDs support renamed players. After applying, repeat the dry run to
confirm preservation, check the returned image URLs for HTTP 200, and inspect
the affected profiles in the live forum. Add verified assets and provenance to
Git; never change checkpointed historical identity metadata to fill an avatar.

To recover an archived account, register and verify a current account, then submit
ownership evidence in **Private Support → Account Recovery**. Only the author and
staff can read the request; indexing, activity feeds and watch mail are disabled.
Staff review the evidence and use XenForo ACP's native user merge with the archived
profile as the source and verified current login as the target. The merge preserves
that login and historical author labels, retargets import checkpoints and redirects
old profile URLs. A matching name alone is insufficient. `storm:accounts --stage prod`
performs the explicitly authorized RiotShielder-to-Jerred merge once; beta skips it.

The theme API shares native preferences and a credentialed, no-store viewer
summary with player docs. Account, alerts, conversations, login, and logout use
native forum routes; the response excludes email and message content. Public social cards
use the effective calendar theme, check guest visibility, and cache by content
and renderer/artwork revision. Personal appearance choices do not change cards.

## Configuration and bootstrap

The homepage keeps the chronological news feed and historical posts. Its join
panel links to Java/Bedrock instructions and the first-session guide; gameplay
images are dated archived photographs from the shared theme's `assets/brand`.
The original cloud wordmark follows the existing seasonal colors. Managed styles
set the classic favicon, cloud application icons, metadata card and email logo;
the assembly also supplies the original root favicon and touch icon. Share-image
URLs and cached cards include the shared artwork revision.

The production portal loads the managed PostHog snippet from `assets/posthog.js`.
Other forum pages, beta and localhost do not load portal analytics. Replay and
autocapture mask rendered text and attributes, including player names and post
snippets. Campaign links use `utm_source`, `utm_medium`, `utm_campaign`, and
`utm_content` to distinguish creatives. The shared browser adapter records
`storm_server_address_copied` only after a successful clipboard write, with
`edition`, `field` (`address` or `port`), and `surface`. Address copies measure
join intent; they do not establish that someone connected to Minecraft. Filter
to `field = address` when comparing conversions so Bedrock port copies do not
count as additional address conversions.

The portal also loads `assets/pinterest.js` with the existing Scout advertiser
tag. It records a PageVisit and one Lead per page after the first successful
address copy, labelled `lead_type = storm_server_address_copied`. Port copies
and repeated clicks do not create additional Pinterest Leads. Local and beta
hosts, Do Not Track, and Global Privacy Control skip the Pinterest tag. Conversion
data contains only the lead type, edition, and a random event identifier. The native privacy page
describes both trackers. This is browser measurement only; no conversion API
or advertising-account automation is involved.

The reviewed `config/welcome-announcement.json` is an editorial post, separate
from generated seed threads. Run `php cmd.php storm:announce` inside the forum
runtime to preview it. After live joining and `/guide` have been verified,
`php cmd.php storm:announce --publish` creates it once through XenForo's native
thread service. A registry receipt prevents duplicates and preserves later
edits and replies. Ordinary releases never publish it automatically.

Product behavior uses typed configuration and the managed `storm` feature flag
namespace. Registration defaults closed. The season flag accepts `auto` or a
catalog ID; registration and calendar flags target the production stage. Automatic
selection uses long festival windows and seasonal gaps in America/Los_Angeles.
The existing minute-by-minute Temporal housekeeping activity reparents followers
only when the effective theme changes. A named operator override also controls
followers; members' explicit themes remain intact. Existing live manual flag
values are preserved until deliberately changed. The
manifest owns native XenForo settings and the direct Minecraft service address.
The status activity reads only the exact Minecraft StatefulSet, then uses private
UDP Query and Geyser probes while the server is ready. It never contacts the
wake-on-join router. The Minecraft plugin filters vanished staff and NPCs before
returning public player identities and occupied arena/RWF games. The forum uses
those identities to render skin heads and count only visible humans in each game.
A shared response identifier prevents the forum from accepting an unfiltered
server during rollout. Java and Bedrock have independent health and reported
versions. `/storm-status/` serves only the public cache and rendered card, with
no game probes. The browser refreshes once a minute while visible and hides live
status, heads, and game summaries after the configured stale interval.
Both cache readers validate aggregate and edition health against the six allowed
combinations in `config/minecraft-status-states.json`.

The worker and PHP reader explicitly migrate the previous v2 name-only cache,
including partial outages without a Java roster. Verified versions survive the
upgrade, but player identities and games require a fresh Query response. Invalid
caches still fail validation. Query contract changes require a compatible forum
runtime release as well as the Minecraft image; publishing the forum image alone
does not advance the production release inventory.

Java players can use `ts-mc.net` through SRV discovery, or explicitly connect to
`mc.ts-mc.net:30000`. Bedrock uses `mc.ts-mc.net` with port `30004`; the website
apex is not its game endpoint. Production remains running so either edition can
join without a wake-up delay. Cached versions remain labelled as last verified
during outages.

Production prerequisites can be prepared with
`scripts/onepassword/with-service-account.sh bun packages/storm-forum/scripts/prepare-production.ts <fresh-upload> <style-exports> <private-output-directory> --apply`.
It verifies and uploads the private bundle, provisions the dedicated runtime item
and scoped storage identities, and emits only release pins and public mail DNS
records. Credentials travel through process pipes and memory. Reload the S3
gateway after its mounted identity configuration updates, then commit the
production release entry using the image digest published by CI.
For an existing installation, `--publish-only` packages, uploads and checks the
new private bundle without changing runtime credentials or storage identities.

The dedicated stage-specific 1Password item supplies these required fields:

| Fields                                            | Consumer                                            |
| ------------------------------------------------- | --------------------------------------------------- |
| `DB_PASSWORD`, `MARIADB_ROOT_PASSWORD`            | Forum and database bootstrap                        |
| `BUNDLE_ACCESS_KEY`, `BUNDLE_SECRET_KEY`          | Private bundle reader, scoped to the release bucket |
| `POSTAL_SMTP_USERNAME`, `POSTAL_SMTP_PASSWORD`    | Postal STARTTLS authentication                      |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`      | Required registration challenge                     |
| `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Fresh-install administrator, release job only       |
| `STAGING_HTTP_AUTH`                               | Beta ingress password file                          |

Database, bundle, and Temporal connection locations are bootstrap inputs
declared by the homelab chart. Credentials are references in configuration and
injected into native mail/CAPTCHA options in memory, never stored in `xf_option`.

## Storage and recovery contract

The database and writable files have separate NVMe claims. Velero's scheduled
backups are their only backup; the forum takes no snapshot of its own. A
release closes requests and waits for the maximum request lifetime before it
migrates. Release journals written before this change may still name an
original release and snapshot; those fields parse and are no longer used.
Completed bootstrap Jobs remain unchanged until the next explicit release.
The ArgoCD application preserves `/spec/template` only for the inventory's exact
versioned Job name. A new release ID creates a new Job with its full declared
template; Job status and health remain part of reconciliation.

Beta declares both primary and recovery PVC pairs so changing the selected pair
cannot prune the original data. Production releases cannot select the recovery
pair.

## Development

Run the root workspace setup, then `bun run build`, `typecheck`, `test`, and `lint`
from this package. Build the runtime with:

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
binds only localhost. Ctrl-C removes its exact containers and network. Postal
delivery still requires deployment acceptance.

Homelab charts and ArgoCD applications consume static stage policy at
`packages/homelab/src/cdk8s/src/resources/storm-forum/releases.json`: storage,
ingress and provisioned credential item IDs. PostgreSQL freezes the selected
original image, licensed bundle and previous release tuple. The chart requires
those exact Helm inputs; source generation neither reads PostgreSQL nor embeds
selected release pins. Initial bootstrap uses an explicit validated descriptor
outside Git, followed by independent runtime baseline verification.
Temporal schedules begin paused and are enabled only after stage acceptance.
