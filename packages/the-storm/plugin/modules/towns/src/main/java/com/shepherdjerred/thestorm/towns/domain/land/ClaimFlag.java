package com.shepherdjerred.thestorm.towns.domain.land;

/** A switch on one claimed chunk. Off is always the protective setting. */
public enum ClaimFlag {
  /** Players may fight each other here. */
  PVP,
  /** Explosions (TNT, creepers, crystals, beds, anchors, wind charges) may change blocks here. */
  EXPLOSIONS,
  /** Fire may spread, burn blocks and be lit by natural causes here. */
  FIRE_SPREAD,
  /** Endermen, ravagers, withers, silverfish and door-breaking zombies may change blocks here. */
  MOB_GRIEFING,
  /** Outsiders may build, break and place entities here. */
  PUBLIC_BUILD,
  /** Outsiders may open containers here. */
  PUBLIC_CONTAINERS,
  /** Outsiders may use doors, buttons, levers and redstone components here. */
  PUBLIC_SWITCHES,
  /** Outsiders may use and hurt animals, villagers, item frames and armor stands here. */
  PUBLIC_ENTITIES,
}
