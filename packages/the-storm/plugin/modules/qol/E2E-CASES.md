# Qol: real-server cases

Behaviour MockBukkit cannot exercise. The e2e suite (`packages/the-storm/tests/e2e`) should cover these.

## Graves

1. Dying with items leaves a player head wearing the owner's face at the death spot; no item entities drop; the player respawns with an empty inventory.
2. `kill -9` the server in the tick after a death (before the grave save finishes): after restart the player still has their items and no grave exists. `kill -9` after the save message: the grave and its items are there, and a missing head block is put back when its chunk loads.
3. While a grave save is running the player cannot drop, move, place or pick up items (keep-inventory window).
4. Falling into the void or dying in lava puts the grave where the player last stood safely; with no safe spot known, near the world spawn.
5. Creepers, TNT, withers, pistons, water and lava never break or move a grave head; breaking it by hand (survival and creative) does nothing.
6. Two players right-clicking an unlocked grave in the same tick never both receive the same stack.
7. The owner right-clicking with a full inventory gets everything: armor, offhand and hotbar back in place, the rest at their feet. A stranger after the lock takes only what fits.
8. A grave in an unloaded chunk past its expiry breaks open (items drop, head removed) the next time a player loads the chunk; `/graves` lists it until then.
9. The `thestorm.qol.graves.admin` permission opens a locked grave (what fits only).

## Combat

10. A PvP hit tags both players: an action-bar countdown shows, `/home` `/spawn` `/tpa` `/back` `/warp` are refused with the time left, and the tag ends after 15 seconds of no hits.
11. Hits cancelled by protection (PvP off in a town or by a player's toggle) do not tag.
12. Quitting (or killing the client, which times out) while tagged kills the player, broadcasts the logout message and leaves a grave; a staff `/kick` or ban does not kill; stopping the server does not kill tagged players.

## Sleep

13. With two players online, one sleeping skips the night after vanilla's five seconds in bed; with three, two are needed; an AFK player does not block the vote; a thunderstorm clears.

## Sort

14. `/sort` while looking at a chest, double chest, barrel, shulker box or ender chest within reach sorts it; looking at anything else explains what can be sorted.
15. A sneaking punch with an empty hand sorts the container and does not start breaking it; in someone else's claim it is refused with the claim's message; a container locked with a key is never sorted.
