package com.shepherdjerred.thestorm.core.protection;

/** What a player is trying to do at a location. */
public enum ProtectedAction {
  /** Place a block or fluid. */
  BUILD,
  /** Break a block. */
  BREAK,
  /** Use doors, gates, trapdoors, buttons, levers and similar blocks. */
  INTERACT,
  /** Open or take from a container. */
  OPEN_CONTAINER,
  /** Change redstone: repeaters, comparators, note blocks, daylight sensors. */
  USE_REDSTONE,
  /** Hurt an animal, item frame, armor stand or other non-hostile entity. */
  DAMAGE_ENTITY,
  /** Use an entity: item frames, armor stands, leads, name tags, villagers. */
  INTERACT_ENTITY,
  /** Place an entity: boats, minecarts, end crystals, armor stands, paintings. */
  PLACE_ENTITY,
}
