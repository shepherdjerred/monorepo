---
title: Spells
description: Bind a focus, gather reagents and cast spells.
---

Spells can help with travel, gathering and combat. Buy levels in the Spellcaster track to unlock the corresponding spell tiers. Some spells also require learning them through a quest. Use `/spells` to see what you can use and `/spells info <spell>` for its details.

To cast a spell you know, use `/spells bind <spell>` to receive its reusable focus. Hold the focus and right-click; each cast consumes the listed reagents from your inventory and starts a cooldown. For example, `/spells bind mark` binds Mark at Spellcaster I. Mark records a place, and Recall returns you to it; bind both and carry their reagents before relying on the trip. Check `/spells info mark` and `/spells info recall` for their costs and cooldowns.

<div><storm-media data-manifest="/media/spell-focus-reagents/media.json"><figure><img alt="A genuinely bound Mark focus is ready with redstone and lapis lazuli." src="/media/spell-focus-reagents/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>A bound Mark focus and ordinary redstone and lapis lazuli are ready for a cast.</figcaption></figure></storm-media></div>
<p><a href="/media/spell-focus-reagents/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/spell-mark-cast/media.json"><figure><img alt="Mark records the current position and spends its required reagents." src="/media/spell-mark-cast/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>Mark records this location and consumes 15 redstone and 15 lapis lazuli.</figcaption></figure></storm-media></div>
<p><a href="/media/spell-mark-cast/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/spell-recall-arrival/media.json"><figure><img alt="Recall returns the player to the recorded Mark after spending the remaining redstone." src="/media/spell-recall-arrival/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>Recall returns to the recorded Mark and consumes the remaining 15 redstone.</figcaption></figure></storm-media></div>
<p><a href="/media/spell-recall-arrival/annotated.webp" download>Download annotated image</a></p>

![Example spell info for Mark, showing Spellcaster I, its reagents and a one-minute cooldown.](/screenshots/spell-mark-info.webp)

The info output names the required track level, ingredients, and cooldown. Check it in game for the current values.

Single-use scrolls work differently: anyone can read one, and the scroll itself is consumed instead of focus reagents. Some spells share a cooldown, such as Dawn and Dusk. Bosses including the Ender Dragon, Wither, Warden and Elder Guardian are immune to spells.

Browse the [spell catalogue](/progression/spell-catalogue/) to choose a spell by tier and effect. The in-game info command shows its current reagents and cooldown.

## If a spell will not cast

Check `/spells info <spell>` for its tier, reagents and cooldown. You need the matching Spellcaster level and, for quest spells, to have learned the spell. Hold its focus in your main hand and carry ordinary reagents; enchanted or special items cannot be spent as reagents. A shared cooldown, silence, an invalid target or protection at the destination can also prevent a cast.
