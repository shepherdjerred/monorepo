---
title: The Storm forum
description: Why commercial forum software, community presentation, private support, and coordinated recovery have separate owners.
---

The Storm forum separates commercial software from the community configuration
and artwork we own. That boundary allows repeatable releases without distributing
licensed packages through public images.

## Commercial inputs stay private

The public runtime contains the Storm integration and its dependencies. A private,
checksummed bundle supplies XenForo and vendor packages when the application starts.
Starting a pod only assembles files; an explicit release job owns installation and
configuration. This prevents restarts from repeating database migrations.
The [runtime boundary](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/README.md)
and [release implementation](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/src/release.ts)
define those responsibilities.

Tracked Flexile customizations supply the base presentation. Building a native
style export combines those customizations with the licensed XenForo master
template, so the source lives in Git while the generated archives stay private.
Each parent archive is pinned by checksum, adaptation version, appearance, and
XenForo version; both pass validation before installation or either import.
Child styles share calendar palettes and artwork with the player documentation.
System appearance follows the device; explicit choices remain native preferences.
Keeping these changes in the [owned style service](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/addon/Storm/Forum/Service/OwnedStyles.php)
allows parent updates without manually recreating community changes.

## Historical profiles preserve attribution

Reviewed public discussions retain original author names and timestamps, with
new replies enabled. Native profiles group posts by original member ID and retain
recovered avatars and attachments. These profiles have no email, password, staff
privileges, or claiming flow. Import checkpoints preserve later edits and replies
during repeat releases. A reviewed revision explicitly migrates unchanged messages
while reporting staff-edited content. The
[runtime boundary](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/README.md)
separates historical attribution from current account ownership.

Reports, appeals, and applications share the forum's moderation tools while
remaining readable only by their author and staff. Native permissions enforce
this boundary. The [configuration service](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/addon/Storm/Forum/Service/Configuration.php)
owns permissions; the [portal](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/addon/Storm/Forum/Pub/Controller/Portal.php)
queries an explicit public-forum allowlist.

## A database dump alone cannot restore attachments

Database rows and writable files form one recovery unit. Maintenance drains active
requests before both are captured. A manifest commits the pair only after both
payloads have been uploaded with checksums. This avoids treating a partial upload
as a usable backup. The [snapshot implementation](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/src/backup.ts)
owns that consistency boundary.

Recovery targets an empty, private beta storage pair. Keeping its original claims
declared preserves beta data while a dedicated restore job reconstructs the snapshot.
The [release chart](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/homelab/src/cdk8s/src/resources/storm-forum/index.ts)
owns that isolation boundary. The
[restore implementation](https://github.com/shepherdjerred/monorepo/blob/f79b0cdaf5e1ec8e08ecd71fecc1e390f3493ddf/packages/storm-forum/src/restore.ts)
checks the payload pair and reapplies beta settings before reopening requests.
Closing registration and replacing the production URL keep restored production
settings from exposing the test installation.

## Status preserves Minecraft hibernation

The forum reads the server's desired state and queries its backend directly.
Contacting the player-facing router would wake the server just to refresh a widget.
The [status activity](https://github.com/shepherdjerred/monorepo/blob/343728604bf9afcb35b6aa526b40ca1c6354f682/packages/storm-forum/src/minecraft.ts)
distinguishes sleeping, starting, online, and unavailable states. Its public cache
contains only public player names and counts. The [Minecraft query listener](https://github.com/shepherdjerred/monorepo/blob/343728604bf9afcb35b6aa526b40ca1c6354f682/packages/the-storm/plugin/modules/messages/src/main/java/com/shepherdjerred/thestorm/messages/adapter/paper/PublicQueryListener.java)
removes vanished staff and NPCs before answering. The [query parser](https://github.com/shepherdjerred/monorepo/blob/343728604bf9afcb35b6aa526b40ca1c6354f682/packages/storm-forum/src/minecraft-query.ts)
requires a shared response identifier before accepting a roster from the server. Java and Bedrock
checks remain independent, so a bridge outage cannot hide a working Java server.
The [browser refresh](https://github.com/shepherdjerred/monorepo/blob/343728604bf9afcb35b6aa526b40ca1c6354f682/packages/storm-forum/browser/minecraft.ts)
reads the cache and cannot wake the game server.
