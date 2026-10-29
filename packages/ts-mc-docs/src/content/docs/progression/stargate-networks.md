---
title: Stargate networks
description: Create a network and manage access to its gates.
---

Create a network before building gates, and choose who can access it.

1. Buy Mechanic III and run `/stargate network create <public|private|town> <name>`. Wait for the `Created network <name>.` message before building a gate.
2. Choose `public` for open access, `private` for yourself and invited players, or `town` for members of your town.
3. For a private network, invite a player with `/stargate network invite <network> <player>`. Remove their access with `/stargate network uninvite <network> <player>`.
4. [Build at least two gates](/progression/build-stargates/) on the network so each has a destination.

<div><storm-media data-manifest="/media/stargate-private-network/media.json"><figure><img alt="Creating a private Stargate network" src="/media/stargate-private-network/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Create a private network before naming it on your gate signs.</figcaption></figure></storm-media></div>

Only the private network owner manages its invitations. Town access follows town membership. Public access lets other players use the network and, with Mechanic III and build permission, add gates. Gate and network names may contain letters, numbers, spaces, underscores and hyphens, up to 32 characters. Put names containing spaces in quotes when using commands.

Revoking a private invitation also removes access while a portal is open. See [Stargates](/progression/stargates/) for travel.
