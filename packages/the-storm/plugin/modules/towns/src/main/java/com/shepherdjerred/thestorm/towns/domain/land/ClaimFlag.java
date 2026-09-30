package com.shepherdjerred.thestorm.towns.domain.land;

/**
 * A switch on one claimed chunk. Off is always the protective setting. There is no container flag:
 * unlocked containers still follow claim permissions, and public-build permits outsiders to open
 * them. Locks can restrict access further.
 */
public enum ClaimFlag {
  /** Players may fight each other here. */
  PVP,
  /** Explosions (TNT, creepers, crystals, beds, anchors, wind charges) may change blocks here. */
  EXPLOSIONS,
  /** Fire may spread, burn blocks and be lit by natural causes here. */
  FIRE_SPREAD,
  /** Endermen, ravagers, withers, silverfish and door-breaking zombies may change blocks here. */
  MOB_GRIEFING,
  /** Outsiders may build, break, place entities and open containers the town guards here. */
  PUBLIC_BUILD,
  /** Outsiders may use doors, buttons, levers and redstone components here. */
  PUBLIC_SWITCHES,
  /** Outsiders may use and hurt animals, villagers, item frames and armor stands here. */
  PUBLIC_ENTITIES,
}
