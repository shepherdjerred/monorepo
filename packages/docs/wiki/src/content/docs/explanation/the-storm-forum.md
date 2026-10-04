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
The [runtime boundary](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/README.md)
and [release implementation](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/src/release.ts)
define those responsibilities.

Vendor style parents supply the base presentation. Independently authored child
styles express the framed teal appearance across light, dark, and seasonal variants.
Keeping these changes in the [owned style service](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/addon/Storm/Forum/Service/OwnedStyles.php)
allows parent updates without manually recreating community changes.

## History does not recreate accounts

The forum starts with fresh discussions and attributed editorial history.
Recreating former accounts would give new content an identity its author never
claimed. The [editorial seed](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/config/seed-content.json)
states that distinction explicitly.

Reports, appeals, and applications share the forum's moderation tools while
remaining readable only by their author and staff. Native permissions enforce
this boundary. The [configuration service](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/addon/Storm/Forum/Service/Configuration.php)
owns permissions; the [portal](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/addon/Storm/Forum/Pub/Controller/Portal.php)
queries an explicit public-forum allowlist.

## A database dump alone cannot restore attachments

Database rows and writable files form one recovery unit. Maintenance drains active
requests before both are captured. A manifest commits the pair only after both
payloads have been uploaded with checksums. This avoids treating a partial upload
as a usable backup. The [snapshot implementation](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/src/backup.ts)
owns that consistency boundary.

Recovery targets an empty, private beta installation. Validating the restored pair
there protects production from an incomplete or mismatched recovery. The
[restore implementation](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/src/restore.ts)
enforces the target and payload constraints.

## Status preserves Minecraft hibernation

The forum reads the server's desired state and pings its backend directly.
Contacting the player-facing router would wake the server just to refresh a widget.
The [status activity](https://github.com/shepherdjerred/monorepo/blob/67aa2340f80764aaaf73bdd91389db008d23a1eb/packages/storm-forum/src/minecraft.ts)
distinguishes sleeping, starting, online, and unavailable states. Its public cache
contains player counts without player names.
