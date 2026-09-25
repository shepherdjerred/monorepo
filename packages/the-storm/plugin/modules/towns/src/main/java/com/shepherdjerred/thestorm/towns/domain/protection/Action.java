package com.shepherdjerred.thestorm.towns.domain.protection;

/**
 * What a player is trying to do. Every value but {@link #ATTACK_PLAYER} mirrors core's {@code
 * ProtectedAction}; PvP is only asked by this module's own listeners.
 */
public enum Action {
  /** Place a block or fluid, or change a block with a tool. */
  BUILD,
  /** Break or take apart a block, trample farmland, harvest, eat cake. */
  BREAK,
  /** Use doors, gates, trapdoors, buttons, levers, beds, bells and similar blocks. */
  INTERACT,
  /** Open or take from a container. */
  OPEN_CONTAINER,
  /** Change redstone: repeaters, comparators, note blocks, daylight sensors, lecterns. */
  USE_REDSTONE,
  /** Hurt an animal, villager, item frame, armor stand or vehicle. */
  DAMAGE_ENTITY,
  /** Use an entity: item frames, armor stands, leads, name tags, villagers, mounts. */
  INTERACT_ENTITY,
  /** Place an entity: boats, minecarts, end crystals, armor stands, paintings. */
  PLACE_ENTITY,
  /** Hurt another player, or another player's pet. */
  ATTACK_PLAYER,
  /** Arrive by any teleport: pearls, chorus fruit, homes, warps, /back, tpa, spells. */
  TELEPORT_INTO,
  /** Save the location as a home or other personal return point. */
  SET_HOME,
}
