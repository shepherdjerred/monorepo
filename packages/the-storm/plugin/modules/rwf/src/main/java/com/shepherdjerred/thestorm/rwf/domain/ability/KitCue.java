package com.shepherdjerred.thestorm.rwf.domain.ability;

/**
 * The sounds and particles kits made in Red Warfare, for the adapter to play. Most are heard by
 * everyone near; those Red Warfare played with {@code player.playSound} ({@link #RESTOCKED}, {@link
 * #LEVEL_UP}, {@link #LEVEL_DOWN}, {@link #SNIPPED}, {@link #BOND_BROKEN} and the sound of {@link
 * #TELEPORTED}) only by the player they play for.
 */
public enum KitCue {
  /** A heart over a healed ally and a level-up chime for them. */
  HEALED,
  /** A black heart: the ally has run out of heals and only gets Regeneration. */
  HEALS_SPENT,
  /** Ice breaking at the victim's feet and body. */
  FROZEN,
  /** A lava pop as hands thaw. */
  THAWED,
  /** An enderman's teleport and ender signal, where someone leaves and lands. */
  WARPED,
  /** Dark red dust from a Bleeder's victim. */
  BLED,
  /** A pressure-plate click and crits: a landmine armed. */
  MINE_ARMED,
  /** A creeper hiss and smoke: a landmine was stepped on. */
  MINE_TRIGGERED,
  /** The item pickup sound, loud, for a returned landmine. */
  RESTOCKED,
  /** An experience orb: a Dwarf levelled up. */
  LEVEL_UP,
  /** A burp: a Dwarf lost a level. */
  LEVEL_DOWN,
  /** Redstone bursts while a Skinner dresses. */
  SKINNING,
  /** Shears: a Sacrificial bond snipped. */
  SNIPPED,
  /** A ghast's scream: a Sacrificial bond broke with a death. */
  BOND_BROKEN,
  /** A break-block burst as a teleporter, banner or barricade comes or goes. */
  BLOCK_CHANGED,
  /** A fishing-rod whoosh as a Grappler is pulled. */
  PULLED,
  /** A bell: the Spotter marked enemies. */
  SPOTTED,
  /** A thump: an Inertia hit a wall. */
  SLAMMED,
  /** A note-block pling: the ability is ready again. */
  READY,
  /** A burst of the team's colour around an invisible kit that was hurt. */
  GHOST_HIT,
  /** An ender signal where a teleporter lands someone, and a low enderman's teleport for them. */
  TELEPORTED,
}
