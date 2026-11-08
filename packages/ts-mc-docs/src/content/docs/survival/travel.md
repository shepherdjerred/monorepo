---
title: Travel
description: Find a place to build and travel between homes, players, and worlds.
---

Use `/rtp` to find a random wilderness location in Frontier, or `/worlds` to choose a destination. Your starter compass also offers a biome choice until your first successful random teleport. See [worlds](/survival/worlds/) for the destinations and their borders.

![The travel menu offers Frontier, Skylands, and Main Map 2.](/screenshots/worlds-menu.webp)

<div><storm-media data-manifest="/media/starter-compass/media.json"><figure><img alt="The genuine starter compass opens the server&apos;s biome chooser." src="/media/starter-compass/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>Right-click the starter compass to choose a biome for a wilderness trip.</figcaption></figure></storm-media></div>
<p><a href="/media/starter-compass/annotated.webp" download>Download annotated image</a></p>

At your shelter, use `/sethome` to save a home and `/home` to return. Right-clicking a bed saves a separate respawn home named `bed`; `/home` without a name goes there. Use `/home <name>` to visit a named home. Your latest bed replaces the previous bed home.

<div><storm-media data-manifest="/media/saved-homes/media.json"><figure><img alt="The saved-home list contains docs-camp, saved at the player&apos;s real position." src="/media/saved-homes/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>Use /sethome docs-camp to save a location and /homes to list saved names.</figcaption></figure></storm-media></div>
<p><a href="/media/saved-homes/annotated.webp" download>Download annotated image</a></p>

Use `/spawn` to return to the windmill, `/back` to return to your previous location, or `/tpa <player>` to ask to visit another player. `/tpahere <player>` asks them to come to you; the other player must accept.

These commands have crystal prices and separate cooldowns. Run `/tpinfo` or `/tpinfo home` to see your current price, cooldown, and readiness. Random teleport is free for your first seven days, but its cooldown still applies. A failed or cancelled trip does not charge you. Walking, boats, mounts, and elytra are useful ways to explore between teleports.

<div><storm-media data-manifest="/media/travel-prices/media.json"><figure><img alt="Use /tpinfo to check the configured price and cooldown for each kind of travel." src="/media/travel-prices/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>Use /tpinfo to check the configured price and cooldown for each kind of travel.</figcaption></figure></storm-media></div>
<p><a href="/media/travel-prices/annotated.webp" download>Download annotated image</a></p>

Teleporting is blocked during a combat tag. See [PvP and safety](/survival/pvp/) before heading out.

## If a trip does not work

- Check `/bal` for your balance and `/tpinfo` for prices and cooldown readiness. Each travel category has its own cooldown.
- Stay still during the warmup. Moving a block or taking damage cancels the trip; a cancelled trip does not charge you.
- Wait until your combat tag ends. Land permissions can also prevent teleporting into a destination.
- If `/home` takes you to a bed instead of your shelter, use `/homes` to see your saved homes and `/home home` for the default home.
- For a player request, make sure the other player accepts it. See [teleport requests](/survival/advanced/teleport-requests/).

For request controls, home limits, and the price table, see [travel commands in detail](/survival/advanced/travel/).
