# Spells: real-server cases

Behaviour MockBukkit cannot exercise. The e2e suite (`packages/the-storm/tests/e2e`) should cover these.

1. Resident vs resident in a PvP-off claim: Fire Nova, Cripple, Freeze, Entomb, Silence, Disarm, Force Push, Geyser, Chain Lightning and Shadowstep have no effect.
2. When the towns PvP listener cancels magic damage, no fire, knockback or potion lands on the victim.
3. `kill -9` after a Wall reverts but before `save-all`: after restart the wall is gone. `kill -9` while the wall stands: it is reverted at startup.
4. Blink aimed at the far side of a glass wall is refused.
5. Area spells do not hit mobs behind walls; Purge and Roar leave a mob farm in someone else's claim alone.
6. Ward and Stealth have no effect on the Warden.
7. Reading a scroll plays the animation, uses the scroll up on success and keeps it when the spell is refused.
8. `WorldSaveEvent` fires on autosave, so reverted temporary-block rows are cleaned up.
