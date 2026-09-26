# Qol: real-server cases

Behaviour MockBukkit cannot exercise (its death, kick, save and skull calls differ from Paper's). The e2e suite (`packages/the-storm/tests/e2e`) should cover these.

## Graves

1. Dying with items leaves a player head wearing the owner's face in open air near the death spot; no item entities drop; the player respawns with an empty inventory; the player's `.dat` file is rewritten within a tick of the death.
2. `kill -9` the server in the tick after a death: after restart the player's saved inventory is empty and the grave (with every item) exists, or the grave does not exist and the player still has the items. Never both, never neither.
3. Stop the server cleanly in the tick after a death: after restart the grave exists once and the inventory is empty.
4. Make the database unwritable, then die: the items come back to the player once (or drop at the death spot if they already left), are logged as Base64, and the head is removed.
5. Make the database unreadable at start: qol logs that it stopped, deaths drop items as vanilla, and no command or listener of qol runs.
6. A grave never replaces water, lava, light blocks, plants, snow or any non-air block; when it goes, the original air (or cave air) is put back.
7. Dying next to someone's claim puts the grave on land the dead player may build on; dying deep inside a claim with no buildable air nearby puts it at the death spot.
8. Falling into the void or dying in lava puts the grave where the player last stood safely; with no safe spot known, near the world spawn.
9. Right-clicking a head in the tick after the death says the grave is still being dug and leaves the head.
10. Creepers, TNT, withers, pistons, water and lava never break or move a grave head; breaking it by hand (survival and creative) does nothing.
11. Two players right-clicking an unlocked grave in the same tick never both receive the same stack.
12. The owner right-clicking with a full inventory gets everything: armor, offhand and hotbar back in place, the rest at their feet. A stranger after the two-hour lock takes only what fits.
13. Seven days after the death the grave's chunk is loaded by the sweep, the items drop there, the original block returns, and the owner is told at once (or on their next join).
14. An arena death (items tagged `thestorm:arena_item`, drops cleared by the arena at LOWEST) leaves no grave and no arena item in any grave.
15. An operator without `thestorm.qol.graves.admin` cannot open a locked grave; with the node from LuckPerms they take what fits.

## Combat

16. A damaging PvP hit (melee, arrow, trident, the attacker's tamed wolf, TNT they lit, a lingering potion they threw) tags both players: an action-bar countdown shows, `/home` `/spawn` `/tpa` `/back` `/warp` are refused with the time left, and the tag ends after 15 seconds without hits. A hit fully blocked by a shield does not tag.
17. Hits cancelled by protection (PvP off in a town or by a player's toggle) do not tag.
18. Quitting or killing the client (timeout) while tagged kills the player, broadcasts the logout message and leaves a grave; a staff `/kick`, a ban or a server error does not kill; stopping the server does not kill tagged players.
19. Fire a player started with flint and steel is not attributed (the game records no source); this is a known gap.

## Sleep

20. With two players online, one sleeping skips the night (vanilla `players_sleeping_percentage` 50); an AFK player does not block the vote and is counted again once active; a thunderstorm clears as vanilla clears it.

## Sort

21. `/sort` while looking at a chest, double chest, barrel, shulker box or ender chest within reach sorts it; looking at anything else explains what can be sorted.
22. A sneaking punch with an empty hand sorts the container and does not start breaking it; in someone else's claim, or when either half of a double chest is in one, it is refused with the claim's message; a container locked with a key is never sorted.
